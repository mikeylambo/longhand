-- Make the two game rules real.
--
-- Until now the palette and the ink budget were enforced only by the UI, which
-- means they were suggestions. A modified client could draw in any of the
-- sixteen colours regardless of what its turn was offered, and submit a layer
-- of any length up to the 2 MB cap. Neither is exploited by anything today, but
-- "the archive is the asset" and an archive whose rules live in a JS bundle has
-- no rules at all.
--
-- Both are now checked in `submit_turn`, against values stored on the canvas
-- rather than constants compiled into a client — same reasoning as width and
-- height: a canvas has to be judged by the rules it was played under, forever.

alter table public.canvases
  add column if not exists ink_budget integer not null default 10000;

comment on column public.canvases.ink_budget is
  'Ink allowed per turn on this canvas. Stored so a closed canvas stays judged '
  'by the rules it was played under, and so the server does not depend on a '
  'client constant.';

/**
 * Recomputes a layer's stroke length from the points actually submitted.
 *
 * The client sends what it measured, but the client is the thing being
 * checked, so its number is only kept when it agrees with this one.
 * `p` is flat [x, y, w, dt, ...]; only x and y matter here.
 */
create or replace function public.layer_ink(p_strokes jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  with st as (
    select s.ordinality as si, s.value as stroke
      from jsonb_array_elements(coalesce(p_strokes -> 'strokes', '[]'::jsonb))
           with ordinality as s(value, ordinality)
  ),
  vals as (
    select st.si,
           (v.ordinality - 1) / 4 as pi,
           (v.ordinality - 1) % 4 as field,
           (v.value #>> '{}')::numeric as n
      from st,
           jsonb_array_elements(coalesce(st.stroke -> 'p', '[]'::jsonb))
           with ordinality as v(value, ordinality)
     where (v.ordinality - 1) % 4 < 2
  ),
  xy as (
    select si, pi,
           max(n) filter (where field = 0) as x,
           max(n) filter (where field = 1) as y
      from vals
     group by si, pi
  ),
  seg as (
    select sqrt(
             power(x - lag(x) over (partition by si order by pi), 2) +
             power(y - lag(y) over (partition by si order by pi), 2)
           ) as d
      from xy
  )
  select coalesce(sum(d), 0) from seg;
$$;

revoke execute on function public.layer_ink(jsonb) from public, anon, authenticated;

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
as $$
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
  if not found then
    raise exception 'no such turn';
  end if;
  if t.state <> 'active' then
    raise exception 'that turn is no longer open';
  end if;
  if t.expires_at < now() then
    update public.turns set state = 'expired' where id = t.id;
    raise exception 'that turn ran out of time';
  end if;
  if not exists (
    select 1 from public.signatures
     where id = t.signature_id and device_key = p_device_key
  ) then
    raise exception 'that turn does not belong to this browser';
  end if;

  n_strokes := jsonb_array_length(coalesce(p_strokes -> 'strokes', '[]'::jsonb));
  if n_strokes = 0 then
    raise exception 'a layer must contain at least one stroke';
  end if;
  if n_strokes > 600 then
    raise exception 'a layer may not contain more than 600 strokes';
  end if;
  if octet_length(p_strokes::text) > 2000000 then
    raise exception 'that layer is too large to store';
  end if;

  select * into c from public.canvases where id = t.canvas_id for update;

  -- Every colour must be one this turn was offered. Turns written before the
  -- palette travelled on the turn fall back to the full master palette rather
  -- than rejecting everything.
  allowed := case
    when t.palette is null or jsonb_array_length(t.palette) = 0
      then (select jsonb_agg(hex order by idx) from public.palette_colors)
    else t.palette
  end;

  select s.value ->> 'c' into bad
    from jsonb_array_elements(p_strokes -> 'strokes') s
   where not (allowed ? (s.value ->> 'c'))
   limit 1;
  if bad is not null then
    raise exception 'colour % was not offered for this turn', bad;
  end if;

  -- And the pen really does run out. Recomputed from the submitted points,
  -- with a little slack for the difference between measuring a path while
  -- drawing it and measuring it again after rounding.
  used := public.layer_ink(p_strokes);
  if used > c.ink_budget * 1.05 then
    raise exception 'that layer uses % of ink, over the % allowed',
      round(used), c.ink_budget;
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
               select s.value ->> 'c'
                 from jsonb_array_elements(p_strokes -> 'strokes') s
             ) u
            where col is not null
         )
   where id = c.id;

  select * into c from public.canvases where id = t.canvas_id;

  return jsonb_build_object('layer', to_jsonb(l), 'canvas', to_jsonb(c));
end
$$;

revoke execute on function public.submit_turn(uuid, jsonb, integer, text)
  from public;
grant execute on function public.submit_turn(uuid, jsonb, integer, text)
  to anon, authenticated;
