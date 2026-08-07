-- A slot should cost more than a tap.
--
-- 0002 has always refused a layer with no strokes at all, which stopped the
-- empty case and nothing else. Playtesting found the gap immediately: one dot
-- is one stroke, so it passed, and a twelfth of somebody's canvas was gone for
-- a mark nobody made on purpose. A slot is not recoverable — the canvas is
-- append-only and the hand is used — so the floor belongs here rather than in
-- a confirmation dialog.
--
-- Measured in ink rather than strokes because a stroke count cannot tell a dot
-- from a line: 600 dots and 600 lines are both 600 strokes. `layer_ink` is
-- already computed two lines below for the *maximum*, so the minimum costs
-- nothing extra and is the same number the meter has been showing the player
-- the whole time.
--
-- 200 is deliberately low. On a phone the sheet is about 5 logical px per css
-- px, so this is roughly a centimetre of drawn line — enough that an accident
-- cannot spend a slot, not so much that somebody adding one small considered
-- mark is told it does not count. `minInk` in src/config.ts carries the same
-- number and the client disables Finish below it; this is the half that cannot
-- be skipped by not using the client.

create or replace function public.submit_turn(
  p_turn       uuid,
  p_strokes    jsonb,
  p_ink        integer,
  p_device_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  t         public.turns;
  c         public.canvases;
  l         public.layers;
  n_strokes int;
  filled    smallint;
  allowed   jsonb;
  bad       text;
  used      numeric;
begin
  select * into t from public.turns where id = p_turn for update;
  if not found then raise exception 'no such turn'; end if;
  if t.state <> 'active' then raise exception 'that turn is no longer open'; end if;
  if t.expires_at < now() then
    update public.turns set state = 'expired' where id = t.id;
    raise exception 'that turn ran out of time';
  end if;
  if not public.owns_signature(t.signature_id, p_device_key) then
    raise exception 'that turn does not belong to this browser';
  end if;

  n_strokes := jsonb_array_length(coalesce(p_strokes -> 'strokes', '[]'::jsonb));
  if n_strokes = 0 then raise exception 'a layer must contain at least one stroke'; end if;
  if n_strokes > 600 then raise exception 'a layer may not contain more than 600 strokes'; end if;
  if octet_length(p_strokes::text) > 2000000 then
    raise exception 'that layer is too large to store';
  end if;

  select * into c from public.canvases where id = t.canvas_id for update;

  allowed := case
    when t.palette is null or jsonb_array_length(t.palette) = 0
      then (select jsonb_agg(hex order by base_idx) from public.palette_colors where step = 0)
    else t.palette
  end;

  select s.value ->> 'c' into bad
    from jsonb_array_elements(p_strokes -> 'strokes') s
   where not public.colour_allowed(s.value ->> 'c', allowed)
   limit 1;
  if bad is not null then
    raise exception 'colour % is not allowed on this canvas', bad;
  end if;

  -- A mode this version does not know would render as a pen stroke today and
  -- as something else later, which is the archive changing under its own feet.
  select s.value ->> 'm' into bad
    from jsonb_array_elements(p_strokes -> 'strokes') s
   where s.value ? 'm' and (s.value ->> 'm') not in ('w', 'f')
   limit 1;
  if bad is not null then
    raise exception 'there is no % tool', bad;
  end if;

  select s.value ->> 'c' into bad
    from jsonb_array_elements(p_strokes -> 'strokes') s
   where (s.value ->> 'm') in ('w', 'f')
     and not public.wash_colour_allowed(s.value ->> 'c')
   limit 1;
  if bad is not null then
    raise exception
      'a wash has to be light enough to tint: % would cover what is under it', bad;
  end if;

  used := public.layer_ink(p_strokes);
  if used > c.ink_budget * 1.05 then
    raise exception 'that layer uses % of ink, over the % allowed', round(used), c.ink_budget;
  end if;
  if used < 200 then
    raise exception 'that is too little to spend a slot on — add a little more';
  end if;

  insert into public.layers
    (canvas_id, slot_index, signature_id, strokes, ink_used)
  values
    (t.canvas_id, t.slot_index, t.signature_id, p_strokes, round(used))
  returning * into l;

  update public.turns set state = 'submitted' where id = t.id;
  select count(*) into filled from public.layers where canvas_id = c.id;

  update public.canvases
     set slots_filled = filled,
         status    = case when filled >= c.slot_count then 'closed' else 'open' end,
         closed_at = case when filled >= c.slot_count then now() else null end,
         palette   = (
           select coalesce(jsonb_agg(distinct col), '[]'::jsonb)
             from (
               select jsonb_array_elements_text(c.palette) as col
               union
               select s.value ->> 'c' from jsonb_array_elements(p_strokes -> 'strokes') s
             ) u
            where col is not null
         )
   where id = c.id;

  select * into c from public.canvases where id = t.canvas_id;
  return jsonb_build_object('layer', to_jsonb(l), 'canvas', to_jsonb(c));
end
$fn$;

-- Proves the floor against the same measure the client shows, inside the
-- migration, so a future change to layer_ink cannot quietly move it. The
-- numbers are measured rather than assumed: a tap comes out at 18, a drawn
-- centimetre at 200.
do $chk$
declare
  tap  jsonb := '{"v":1,"strokes":[{"c":"#1B1A17","s":1,"t":0,"i":4,"p":[0,0,3,0, 2,2,3,1]}]}';
  line jsonb := '{"v":1,"strokes":[{"c":"#1B1A17","s":1,"t":0,"i":500,"p":[0,0,3,0, 250,0,3,1, 500,0,3,2]}]}';
begin
  if public.layer_ink(tap) >= 200 then
    raise exception 'a tap measures % ink and would still spend a slot', public.layer_ink(tap);
  end if;
  if public.layer_ink(line) < 200 then
    raise exception 'a drawn line measures only % ink, so the floor is too high',
      public.layer_ink(line);
  end if;
end
$chk$;
