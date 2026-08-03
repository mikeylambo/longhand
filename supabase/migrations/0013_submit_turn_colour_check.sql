-- submit_turn asks colour_allowed() rather than checking membership itself,
-- so the sixteen swatches, the tints and shades behind them, and a hue mixed
-- off the wheel all go through one rule.

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
  if not found then raise exception 'no such turn'; end if;
  if t.state <> 'active' then raise exception 'that turn is no longer open'; end if;
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

  -- A colour is legal if it belongs to a family this turn was offered — which
  -- covers the sixteen swatches and the tints and shades behind them — or if it
  -- is a custom hue inside the palette's tonal gamut.
  select s.value ->> 'c' into bad
    from jsonb_array_elements(p_strokes -> 'strokes') s
   where not public.colour_allowed(s.value ->> 'c', allowed)
   limit 1;
  if bad is not null then
    raise exception 'colour % is not allowed on this canvas', bad;
  end if;

  -- Recomputed from the submitted points. The client's figure is never trusted;
  -- an oversized layer cannot be undone once written, only hidden.
  used := public.layer_ink(p_strokes);
  if used > c.ink_budget * 1.05 then
    raise exception 'that layer uses % of ink, over the % allowed', round(used), c.ink_budget;
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
$$;

revoke execute on function public.submit_turn(uuid, jsonb, integer, text) from public;
grant execute on function public.submit_turn(uuid, jsonb, integer, text) to anon, authenticated;
