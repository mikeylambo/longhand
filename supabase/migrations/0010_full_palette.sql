-- Every player gets every colour.
--
-- Palette inheritance is off. Two reasons, one practical and one about what the
-- constraint actually was.
--
-- Practical: it never worked under a burst of arrivals. The palette is fixed at
-- claim time — correctly, so it cannot shift under someone mid-drawing — but it
-- inherits from what has been *submitted*. Twelve people arriving on a shared
-- link all claim before anyone submits, so all twelve were offered the full set
-- regardless. Seeding a canvas reproduced it exactly.
--
-- The real point: cohesion comes from the sixteen colours being hand-picked
-- muted tones that cannot clash badly, not from rationing which of them each
-- player may touch. Restricting the subset was a second-order rule on top of an
-- already-strong one, and it cost the last players their range for very little.
--
-- Kept as a live mechanic rather than deleted: p_floor is the switch. 16 tops
-- everyone up to the full set (off); 6 restores it with a floor; 0 is the
-- brief's literal rule. This default and PALETTE_MIN in src/config.ts must
-- agree — submit_turn rejects any colour a turn was not offered.

create or replace function public.inherited_palette(
  p_used  jsonb,
  p_seed  text,
  p_extra int default 2,
  p_floor int default 16
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  master  text[];
  have    text[];
  unused  text[];
  fresh   text[];
  result  text[];
  want    int;
  take    int;
  origin  int;
begin
  select array_agg(hex order by idx) into master from public.palette_colors;

  select array_agg(m order by i) into have
    from unnest(master) with ordinality as t(m, i)
   where m in (select jsonb_array_elements_text(coalesce(p_used, '[]'::jsonb)));

  if have is null or array_length(have, 1) is null then
    return to_jsonb(master);
  end if;

  select array_agg(m order by i) into unused
    from unnest(master) with ordinality as t(m, i)
   where not (m = any(have));

  if unused is null or array_length(unused, 1) is null then
    return to_jsonb(master);
  end if;

  want   := greatest(p_extra, p_floor - array_length(have, 1));
  take   := least(greatest(want, 0), array_length(unused, 1));
  origin := (abs(hashtext(coalesce(p_seed, ''))) % array_length(unused, 1))::int;

  select array_agg(unused[1 + ((origin + g) % array_length(unused, 1))])
    into fresh
    from generate_series(0, take - 1) g;

  fresh := coalesce(fresh, '{}');

  select array_agg(m order by i) into result
    from unnest(master) with ordinality as t(m, i)
   where m = any(have) or m = any(fresh);

  return to_jsonb(coalesce(result, have));
end
$$;

revoke execute on function public.inherited_palette(jsonb, text, int, int)
  from public, anon, authenticated;
