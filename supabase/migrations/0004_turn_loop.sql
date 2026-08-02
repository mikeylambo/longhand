-- Milestone 3 — the loop. Slot claiming, the turn timer, expiry, and
-- submit-and-lock.
--
-- Until now a slot was taken at the moment a layer was submitted, which meant
-- nothing reserved it while somebody was drawing, and one player could fill a
-- whole canvas alone. Both are fixed here.
--
-- The concurrency guarantee is stated three times over, deliberately, because a
-- double-booked slot fails silently and is only discovered when a canvas
-- closes wrong:
--
--   1. an advisory lock serialises claiming
--   2. the canvas row is locked FOR UPDATE while its free slot is computed
--   3. a partial unique index makes a double-booked slot impossible to store
--      even if 1 and 2 were both wrong
--
-- The index is the one that actually matters. Locks are reasoning; a constraint
-- is a fact.

-- ------------------------------------------------------- the master palette

-- Lives in the database because the server is authoritative for what a player
-- may draw with. Changing the palette must not require a client deploy.
create table if not exists public.palette_colors (
  idx smallint primary key,
  hex text not null unique
);

insert into public.palette_colors (idx, hex) values
  (0,  '#1B1A17'), (1,  '#5B5850'), (2,  '#9C978B'), (3,  '#FBF8F1'),
  (4,  '#A73A34'), (5,  '#DD6238'), (6,  '#E5A23C'), (7,  '#B8873C'),
  (8,  '#7C8A47'), (9,  '#48764F'), (10, '#2C7A73'), (11, '#3B6288'),
  (12, '#2B3A72'), (13, '#6A4B82'), (14, '#A94578'), (15, '#E3A59C')
on conflict (idx) do update set hex = excluded.hex;

alter table public.palette_colors enable row level security;

drop policy if exists palette_read on public.palette_colors;
create policy palette_read on public.palette_colors
  for select to anon, authenticated using (true);

/**
 * Palette inheritance: the colours already on the canvas, plus a couple of new
 * ones. The brief's rule assumes an opening layer used several colours — when
 * it used one, the next player is handed a three-swatch box, which reads as
 * broken rather than as a constraint. p_floor tops it up. Pass 0 for the
 * brief's literal rule.
 *
 * Offset by the canvas id so two canvases that share a palette still drift
 * apart.
 */
create or replace function public.inherited_palette(
  p_used  jsonb,
  p_seed  text,
  p_extra int default 2,
  p_floor int default 6
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

  -- Slot 1 draws with everything.
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

-- --------------------------------------------------- twelve distinct hands

-- The whole premise is twelve strangers. Without this one person fills a
-- canvas alone and the product is a single-player drawing app.
create unique index if not exists layers_one_per_signature
  on public.layers (canvas_id, signature_id);

-- -------------------------------------------------------------- turn table

alter table public.turns
  add column if not exists palette jsonb not null default '[]'::jsonb;

-- A slot may be held by at most one live turn. This is the constraint the
-- concurrency test is actually asserting.
drop index if exists public.turns_active_slot_uniq;
create unique index turns_active_slot_uniq
  on public.turns (canvas_id, slot_index)
  where state = 'active';

-- And a player holds at most one turn anywhere, so nobody can reserve the
-- board while they think about it.
drop index if exists public.turns_one_active_per_signature;
create unique index turns_one_active_per_signature
  on public.turns (signature_id)
  where state = 'active';

-- ------------------------------------------------------------------ expiry

/**
 * Releases abandoned slots. Called on a schedule, and also opportunistically at
 * the top of every claim, so the loop keeps healing even if the scheduler is
 * not running — a canvas frozen behind someone who closed their tab is the
 * failure that quietly kills the whole relay.
 */
create or replace function public.sweep_expired_turns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.turns
     set state = 'expired'
   where state = 'active'
     and expires_at < now();
  get diagnostics n = row_count;
  return n;
end
$$;

-- ------------------------------------------------------------------- claim

/**
 * Hands the player a slot and starts their clock.
 *
 * Reloading the page must not burn a slot, so an existing live turn is
 * returned as-is rather than a second one being claimed. A player never gets a
 * second slot on a canvas they have already drawn on.
 */
create or replace function public.claim_turn(
  p_signature  uuid,
  p_device_key text,
  p_minutes    int default 10
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.canvases;
  t        public.turns;
  idx      smallint;
  pal      jsonb;
  attempts int := 0;
begin
  if p_device_key is null or length(p_device_key) < 8 then
    raise exception 'a device key is required to claim a turn';
  end if;
  if not exists (
    select 1 from public.signatures
     where id = p_signature and device_key = p_device_key
  ) then
    raise exception 'that signature does not belong to this browser';
  end if;

  perform public.sweep_expired_turns();

  -- Resume rather than re-claim.
  select * into t
    from public.turns
   where signature_id = p_signature and state = 'active' and expires_at > now()
   limit 1;

  if found then
    select * into c from public.canvases where id = t.canvas_id;
    return jsonb_build_object('turn', to_jsonb(t), 'canvas', to_jsonb(c), 'resumed', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('longhand.claim'));

  loop
    attempts := attempts + 1;
    exit when attempts > 8;

    -- "Has a free slot" has to be part of the predicate, not a status flag.
    -- A canvas whose remaining slots are all held by live turns is neither
    -- closed nor available, and selecting on status alone would hand it back
    -- every iteration.
    select * into c
      from public.canvases
     where status <> 'closed'
       and slots_filled < slot_count
       and not exists (
         select 1 from public.layers l
          where l.canvas_id = canvases.id and l.signature_id = p_signature
       )
       and exists (
         select 1
           from generate_series(1, canvases.slot_count) gs
          where not exists (
                  select 1 from public.layers l
                   where l.canvas_id = canvases.id and l.slot_index = gs)
            and not exists (
                  select 1 from public.turns tt
                   where tt.canvas_id = canvases.id and tt.slot_index = gs
                     and tt.state = 'active' and tt.expires_at > now())
       )
     order by created_at
     limit 1
     for update;

    if not found then
      insert into public.canvases (seed_word)
      values (public.pick_seed())
      returning * into c;
    end if;

    select gs into idx
      from generate_series(1, c.slot_count) gs
     where not exists (
             select 1 from public.layers l
              where l.canvas_id = c.id and l.slot_index = gs)
       and not exists (
             select 1 from public.turns tt
              where tt.canvas_id = c.id and tt.slot_index = gs
                and tt.state = 'active' and tt.expires_at > now())
     order by gs
     limit 1;

    -- Unreachable given the predicate above; kept as a loop guard rather than
    -- a silent null slot_index.
    if idx is null then
      continue;
    end if;

    pal := public.inherited_palette(c.palette, c.id::text);

    insert into public.turns
      (canvas_id, slot_index, signature_id, expires_at, state, palette)
    values
      (c.id, idx, p_signature, now() + make_interval(mins => p_minutes), 'active', pal)
    returning * into t;

    return jsonb_build_object('turn', to_jsonb(t), 'canvas', to_jsonb(c), 'resumed', false);
  end loop;

  raise exception 'could not find a free slot';
end
$$;

/** Gives a slot back voluntarily — closing the tab should not cost ten minutes
 *  of a canvas's life if the player says they are done. */
create or replace function public.release_turn(
  p_turn       uuid,
  p_device_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.turns t
     set state = 'expired'
    from public.signatures s
   where t.id = p_turn
     and t.signature_id = s.id
     and s.device_key = p_device_key
     and t.state = 'active';
  get diagnostics n = row_count;
  return n > 0;
end
$$;

-- ------------------------------------------------------------------ submit

/**
 * Submit-and-lock. Replaces submit_layer: a layer can now only be written
 * against a live turn, at the slot that turn reserved.
 */
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

  insert into public.layers
    (canvas_id, slot_index, signature_id, strokes, ink_used)
  values
    (t.canvas_id, t.slot_index, t.signature_id, p_strokes,
     least(1000000, greatest(0, coalesce(p_ink, 0))))
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

-- The unguarded path is gone: layers may only be written against a claimed turn.
drop function if exists public.submit_layer(uuid, uuid, jsonb, integer, text);

-- -------------------------------------------------------------------- grants

revoke all on function public.claim_turn(uuid, text, int) from public;
revoke all on function public.release_turn(uuid, text) from public;
revoke all on function public.submit_turn(uuid, jsonb, integer, text) from public;
revoke all on function public.sweep_expired_turns() from public;

grant execute on function public.claim_turn(uuid, text, int) to anon, authenticated;
grant execute on function public.release_turn(uuid, text) to anon, authenticated;
grant execute on function public.submit_turn(uuid, jsonb, integer, text) to anon, authenticated;
-- The sweep is for the scheduler, not for clients.

comment on function public.claim_turn(uuid, text, int) is
  'Reserves a slot and starts the turn clock. SECURITY DEFINER and anon-executable on purpose: v1 has no accounts. Bound to the device key that created the signature.';
comment on function public.submit_turn(uuid, jsonb, integer, text) is
  'Writes a layer against a live turn. SECURITY DEFINER and anon-executable on purpose: v1 has no accounts.';
