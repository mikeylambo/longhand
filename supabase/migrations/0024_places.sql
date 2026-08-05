-- Where a canvas closed.
--
-- The deliberate inversion of a territorial pixel board: that is a battlefield
-- where your work gets painted over, and this is a map of finished pieces
-- nobody can touch. The map is the archive made legible, and it is the reason
-- the archive gets more valuable every year rather than longer.
--
-- The safety position written in Phase A says this product knows nothing about
-- where anybody is, and that has to stay true. So:
--
--   * A place is a *city*, chosen from a list, and never a coordinate read off
--     a device. Nobody is asked for location permission anywhere in this
--     product, and there is no browser API call to give one.
--   * It belongs to the canvas, not to a person. A canvas is a place a picture
--     happened; a hand has no location and never gets one.
--   * It is optional, and a canvas with no place is an ordinary canvas rather
--     than an incomplete one.
--
-- A city is coarse enough to be meaningless as a way of finding somebody and
-- specific enough to mean something on a map, which is the whole of the design.

create table if not exists public.places (
  id      text primary key,
  name    text not null,
  country text not null,
  lat     numeric(8, 4) not null,
  lon     numeric(9, 4) not null
);

insert into public.places (id, name, country, lat, lon) values
  ('london',      'London',        'United Kingdom',  51.5074,  -0.1278),
  ('manchester',  'Manchester',    'United Kingdom',  53.4808,  -2.2426),
  ('glasgow',     'Glasgow',       'United Kingdom',  55.8642,  -4.2518),
  ('dublin',      'Dublin',        'Ireland',         53.3498,  -6.2603),
  ('paris',       'Paris',         'France',          48.8566,   2.3522),
  ('berlin',      'Berlin',        'Germany',         52.5200,  13.4050),
  ('amsterdam',   'Amsterdam',     'Netherlands',     52.3676,   4.9041),
  ('lisbon',      'Lisbon',        'Portugal',        38.7223,  -9.1393),
  ('madrid',      'Madrid',        'Spain',           40.4168,  -3.7038),
  ('rome',        'Rome',          'Italy',           41.9028,  12.4964),
  ('stockholm',   'Stockholm',     'Sweden',          59.3293,  18.0686),
  ('warsaw',      'Warsaw',        'Poland',          52.2297,  21.0122),
  ('istanbul',    'Istanbul',      'Türkiye',         41.0082,  28.9784),
  ('lagos',       'Lagos',         'Nigeria',          6.5244,   3.3792),
  ('nairobi',     'Nairobi',       'Kenya',           -1.2921,  36.8219),
  ('cairo',       'Cairo',         'Egypt',           30.0444,  31.2357),
  ('cape-town',   'Cape Town',     'South Africa',   -33.9249,  18.4241),
  ('new-york',    'New York',      'United States',   40.7128, -74.0060),
  ('chicago',     'Chicago',       'United States',   41.8781, -87.6298),
  ('los-angeles', 'Los Angeles',   'United States',   34.0522,-118.2437),
  ('mexico-city', 'Mexico City',   'Mexico',          19.4326, -99.1332),
  ('toronto',     'Toronto',       'Canada',          43.6532, -79.3832),
  ('sao-paulo',   'São Paulo',     'Brazil',         -23.5505, -46.6333),
  ('buenos-aires','Buenos Aires',  'Argentina',      -34.6037, -58.3816),
  ('bogota',      'Bogotá',        'Colombia',         4.7110, -74.0721),
  ('mumbai',      'Mumbai',        'India',           19.0760,  72.8777),
  ('delhi',       'Delhi',         'India',           28.6139,  77.2090),
  ('bengaluru',   'Bengaluru',     'India',           12.9716,  77.5946),
  ('karachi',     'Karachi',       'Pakistan',        24.8607,  67.0011),
  ('dubai',       'Dubai',         'United Arab Emirates', 25.2048, 55.2708),
  ('singapore',   'Singapore',     'Singapore',        1.3521, 103.8198),
  ('bangkok',     'Bangkok',       'Thailand',        13.7563, 100.5018),
  ('jakarta',     'Jakarta',       'Indonesia',       -6.2088, 106.8456),
  ('manila',      'Manila',        'Philippines',     14.5995, 120.9842),
  ('hong-kong',   'Hong Kong',     'Hong Kong SAR',   22.3193, 114.1694),
  ('shanghai',    'Shanghai',      'China',           31.2304, 121.4737),
  ('seoul',       'Seoul',         'South Korea',     37.5665, 126.9780),
  ('tokyo',       'Tokyo',         'Japan',           35.6762, 139.6503),
  ('sydney',      'Sydney',        'Australia',      -33.8688, 151.2093),
  ('melbourne',   'Melbourne',     'Australia',      -37.8136, 144.9631),
  ('auckland',    'Auckland',      'New Zealand',    -36.8485, 174.7633)
on conflict (id) do update
  set name = excluded.name, country = excluded.country,
      lat = excluded.lat, lon = excluded.lon;

alter table public.places enable row level security;

drop policy if exists places_read on public.places;
create policy places_read on public.places
  for select to anon, authenticated using (true);
grant select on public.places to anon, authenticated;

alter table public.canvases
  add column if not exists place_id text references public.places (id);

create index if not exists canvases_place_idx
  on public.canvases (place_id) where status = 'closed';

comment on column public.canvases.place_id is
  'The city a canvas is pinned to on the world map. Chosen from a list by the '
  'hand that opened it, never read from a device, and belonging to the canvas '
  'rather than to any person.';

/**
 * Names the place for a canvas, once.
 *
 * The first hand decides, and only while the canvas is still theirs to decide
 * about — a place that could be changed by the twelfth player is a place the
 * first eleven did not agree to. Left unset, the canvas simply has no place,
 * which is the ordinary case and not a lesser one.
 */
create or replace function public.set_canvas_place(
  p_canvas     uuid,
  p_place      text,
  p_signature  uuid,
  p_device_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare c public.canvases;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;
  if p_place is not null and not exists (select 1 from public.places where id = p_place) then
    raise exception 'there is no place called %', p_place;
  end if;

  select * into c from public.canvases where id = p_canvas for update;
  if not found then raise exception 'no such canvas'; end if;
  if c.place_id is not null then
    raise exception 'that canvas already has a place';
  end if;
  if not exists (
    select 1 from public.layers
     where canvas_id = p_canvas and slot_index = 1 and signature_id = p_signature
  ) then
    raise exception 'only the hand that opened a canvas can name where it is';
  end if;

  update public.canvases set place_id = p_place where id = p_canvas;
  return true;
end
$$;

revoke execute on function public.set_canvas_place(uuid, text, uuid, text) from public;
grant execute on function public.set_canvas_place(uuid, text, uuid, text)
  to anon, authenticated;
