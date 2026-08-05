-- Seeds that change without a deploy, and canvases a guest opens.
--
-- The cheapest renewable thing this product has. A seed word is one row, it
-- costs nothing to run, and it is the only lever that changes what a canvas
-- *is* without changing any code — which matters for a solo project that has
-- to stay interesting for years without a content pipeline.
--
-- Four kinds, in the order `pick_seed` considers them:
--
--   daily      one word for one date. Today's seed, everywhere.
--   seasonal   a window — a holiday, a week, a drop.
--   place      tied to a place, used when a canvas is opened there.
--   evergreen  the original twelve, and the fallback that always exists.
--
-- The fallback matters more than the scheduling: a day with nothing scheduled
-- must be an ordinary day, not a broken one.

alter table public.seeds
  add column if not exists kind text not null default 'evergreen'
    check (kind in ('evergreen', 'daily', 'seasonal', 'place')),
  add column if not exists starts_on date,
  add column if not exists ends_on   date,
  add column if not exists place_id  text,
  add column if not exists retired   boolean not null default false;

create index if not exists seeds_schedule_idx
  on public.seeds (kind, starts_on, ends_on) where not retired;

comment on table public.seeds is
  'Seed words, scheduled. Adding one is a row, not a deploy — see pick_seed().';

/**
 * Which word a new canvas opens on.
 *
 * Deliberately narrowing rather than random-across-everything: a daily seed is
 * *the* seed for that day, because half the point of a daily is that two
 * strangers who arrive an hour apart are answering the same word. Seasonal
 * windows come next, then evergreen. A place seed is only ever chosen when a
 * canvas is opened at that place, so it never leaks into the general pool.
 */
create or replace function public.pick_seed(p_place text default null)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  w text;
begin
  -- A place with its own words uses them, when there are any.
  if p_place is not null then
    select word into w
      from public.seeds
     where kind = 'place' and place_id = p_place and not retired
     order by random() limit 1;
    if w is not null then return w; end if;
  end if;

  select word into w
    from public.seeds
   where kind = 'daily' and not retired
     and starts_on = current_date
   limit 1;
  if w is not null then return w; end if;

  select word into w
    from public.seeds
   where kind = 'seasonal' and not retired
     and coalesce(starts_on, current_date) <= current_date
     and coalesce(ends_on,   current_date) >= current_date
   order by random() limit 1;
  if w is not null then return w; end if;

  select word into w
    from public.seeds
   where kind = 'evergreen' and not retired
   order by random() limit 1;

  -- Every scheduled seed retired at once is an operator mistake, not a reason
  -- to fail a claim. A canvas with a dull word beats no canvas.
  return coalesce(w, 'the long way home');
end
$$;

-- The old no-argument form has to go: PostgREST would find both ambiguous, and
-- the definer functions that call it should be explicit about the place anyway.
drop function if exists public.pick_seed();

revoke execute on function public.pick_seed(text) from public, anon, authenticated;

-- ------------------------------------------------------------ guest artists

/**
 * Opens a canvas with slot 1 already held for somebody.
 *
 * A guest artist starting a canvas is the cheapest programming this product
 * has, and it needs no new mechanic — only a turn that does not expire in ten
 * minutes. Their hand lands first, everybody else answers it, and the canvas
 * behaves like every other canvas from slot 2 onwards.
 *
 * Operator-only. A slot held open for days is exactly the thing `claim_turn`
 * refuses to let a player do, so it cannot be a player-facing call.
 */
create or replace function public.open_guest_canvas(
  p_signature uuid,
  p_slots     int default 12,
  p_seed      text default null,
  p_hours     int default 72
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.canvases;
  t public.turns;
begin
  if not exists (select 1 from public.signatures where id = p_signature) then
    raise exception 'no such signature';
  end if;
  if not exists (select 1 from public.canvas_formats where slot_count = p_slots) then
    raise exception 'there is no % hand format', p_slots;
  end if;

  insert into public.canvases (seed_word, slot_count)
  values (coalesce(p_seed, public.pick_seed()), p_slots::smallint)
  returning * into c;

  insert into public.turns
    (canvas_id, slot_index, signature_id, expires_at, state, palette)
  values
    (c.id, 1, p_signature, now() + make_interval(hours => p_hours), 'active',
     public.inherited_palette('[]'::jsonb, c.id::text))
  returning * into t;

  return jsonb_build_object('canvas', to_jsonb(c), 'turn', to_jsonb(t));
end
$$;

revoke execute on function public.open_guest_canvas(uuid, int, text, int)
  from public, anon, authenticated;
grant execute on function public.open_guest_canvas(uuid, int, text, int) to service_role;

-- ---------------------------------------------------------- a starting set

-- The original twelve become the evergreen pool explicitly rather than by
-- default, and a first handful of seasonal words go in so the scheduling has
-- something to do on the day it ships.
update public.seeds set kind = 'evergreen' where kind is null;

insert into public.seeds (word, kind, starts_on, ends_on) values
  ('the shortest day',  'seasonal', '2026-12-18', '2026-12-23'),
  ('first frost',       'seasonal', '2026-11-01', '2026-11-30'),
  ('the last warm day', 'seasonal', '2026-09-01', '2026-09-30'),
  ('long light',        'seasonal', '2026-06-15', '2026-06-30')
on conflict (word) do update
  set kind = excluded.kind,
      starts_on = excluded.starts_on,
      ends_on = excluded.ends_on;
