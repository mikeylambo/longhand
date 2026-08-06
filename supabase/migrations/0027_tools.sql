-- The tools, as the ledger sees them.
--
-- Stamps and texture pens needed nothing here: they emit ordinary strokes and
-- the archive cannot tell them from a hand. Two things did need saying in the
-- database, because both are rules rather than rendering:
--
--   1. What a mark costs. `layer_ink` measures travelled distance, which is
--      right for a line and wrong for a dot: a stipple mark has no length, so
--      six hundred of them cost nothing and the ink budget — the one thing
--      that makes a turn finite — stops applying. The client already charges a
--      floor per mark; this makes the server charge the same one, so neither
--      has to trust the other.
--
--   2. What a wash may be. A multiply is additive in the sense that it never
--      removes a pixel, and completely destructive in the sense that a dark
--      enough one repeated over somebody's work leaves a black rectangle. The
--      promise is "nothing you add can remove anyone else's", and it has to
--      hold against a tool as well as against a code path. So a wash is
--      restricted to colours light enough to tint rather than blot, and that
--      is checked at the door rather than in the client.
--
-- Unknown modes are refused outright. A layer carrying a mode this version has
-- never heard of would render as a plain pen stroke in every renderer that
-- exists today and as something else in some renderer later — which is the
-- archive quietly changing, and that is the one thing it must never do.

-- ------------------------------------------------------------- what ink costs

/** The floor a single mark costs, matching MARK_FLOOR in src/engine/tools.ts. */
create or replace function public.mark_floor()
returns numeric language sql immutable
set search_path = public   -- pinned like every other function here; see 0029
as $$ select 18::numeric $$;

/**
 * Ink for a layer, recomputed from the geometry.
 *
 * Unchanged for a drawn line, where the travelled distance is far past the
 * floor. The floor only bites on marks with little or no length — dots and
 * ticks — which is exactly the case the old measurement priced at nothing.
 */
-- Same walk as 0009, which was verified against known geometry — a 1000px line
-- measuring exactly 1000. The only change is the last line: length is taken
-- per stroke and floored, rather than summed straight across the layer.
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
    select si,
           sqrt(
             power(x - lag(x) over (partition by si order by pi), 2) +
             power(y - lag(y) over (partition by si order by pi), 2)
           ) as d
      from xy
  ),
  per_stroke as (
    select st.si, coalesce(sum(seg.d), 0) as len
      from st left join seg on seg.si = st.si
     group by st.si
  )
  select coalesce(sum(greatest(len, public.mark_floor())), 0) from per_stroke;
$$;

revoke execute on function public.layer_ink(jsonb) from public, anon, authenticated;
revoke execute on function public.mark_floor() from public, anon, authenticated;

-- --------------------------------------------------------------- what a wash is

/**
 * A wash colour has to be light enough to tint.
 *
 * Lightness only, deliberately: the palette's own tonal range is already
 * enforced by `colour_in_gamut`, so the extra rule here is the one thing a
 * multiply adds — that a dark colour under a multiply is a way of covering
 * somebody up. 46 is a little above the middle of the palette's L range, which
 * leaves the tints, the chalk and the lighter half of every family, and
 * excludes ink, graphite and the deep reds and blues.
 */
create or replace function public.wash_colour_allowed(p_hex text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  r numeric; g numeric; b numeric; mx numeric; mn numeric; l numeric;
begin
  if p_hex is null or p_hex !~ '^#[0-9A-Fa-f]{6}$' then return false; end if;
  r := ('x' || substr(p_hex, 2, 2))::bit(8)::int / 255.0;
  g := ('x' || substr(p_hex, 4, 2))::bit(8)::int / 255.0;
  b := ('x' || substr(p_hex, 6, 2))::bit(8)::int / 255.0;
  mx := greatest(r, g, b);
  mn := least(r, g, b);
  l := (mx + mn) / 2 * 100;
  return l >= 46;
end
$$;

revoke execute on function public.wash_colour_allowed(text) from public, anon, authenticated;

-- ------------------------------------------------------------------- submit

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
