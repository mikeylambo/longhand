-- A custom colour is any hue you like, in this world's light.
--
-- The sixteen work together because they share a tonal range, not because of
-- which hues they are: the chromatic ones sit at saturation 24-77% and
-- lightness 31-75%. So hue is free and the other two axes are fenced. A player
-- can bring their own colour and still not be able to put a neon stroke into an
-- archive that can never be edited.
--
-- Measured from the palette rather than picked, and deliberately a touch wider
-- than the sixteen so custom colours are not all near-duplicates of them.
-- src/colour.ts carries the same numbers; tests/colour.spec.ts holds them level.

create or replace function public.hex_sl(p_hex text)
returns table (s numeric, l numeric)
language sql
immutable
set search_path = public
as $$
  with c as (
    select ('x' || substr(p_hex, 2, 2))::bit(8)::int / 255.0 as r,
           ('x' || substr(p_hex, 4, 2))::bit(8)::int / 255.0 as g,
           ('x' || substr(p_hex, 6, 2))::bit(8)::int / 255.0 as b
  ),
  m as (
    select greatest(r, g, b) as mx, least(r, g, b) as mn from c
  )
  select case
           when mx = mn then 0
           when (mx + mn) / 2 > 0.5 then (mx - mn) / nullif(2 - mx - mn, 0)
           else (mx - mn) / nullif(mx + mn, 0)
         end * 100,
         (mx + mn) / 2 * 100
    from m;
$$;

create or replace function public.colour_in_gamut(p_hex text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_hex ~ '^#[0-9A-Fa-f]{6}$'
     and exists (
       select 1 from public.hex_sl(p_hex) x
        where x.s between 18 and 72
          and x.l between 28 and 72
     );
$$;

/**
 * The one place that decides whether a stroke's colour is legal.
 *
 * Either it belongs to a palette family this turn was offered — which covers
 * the sixteen swatches and the tints and shades behind them — or it is a custom
 * hue inside the tonal gamut above.
 */
create or replace function public.colour_allowed(p_hex text, p_palette jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.palette_colors pc
      join public.palette_colors base
        on base.base_idx = pc.base_idx and base.step = 0
     where upper(pc.hex) = upper(p_hex)
       and p_palette ? base.hex
  ) or public.colour_in_gamut(p_hex);
$$;

revoke execute on function public.hex_sl(text) from public, anon, authenticated;
revoke execute on function public.colour_in_gamut(text) from public, anon, authenticated;
revoke execute on function public.colour_allowed(text, jsonb) from public, anon, authenticated;
