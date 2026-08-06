-- An identity that survives a cleared browser.
--
-- The device key has been a bearer token in local storage since milestone 2.
-- Clearing it loses your mark; copying it takes over your mark. That was an
-- honest trade for a slice with no accounts, and it stops being one the moment
-- anything is *sent* to a person — a notification that a canvas you drew on
-- has closed is worthless if "you" is a string that a browser update can drop.
--
-- So two changes, neither of which is an account:
--
--   1. A signature is held by a *set* of devices, not one. Adding a phone to a
--      laptop is now a thing that can happen.
--   2. A recovery key, minted by the server, shown once, and stored only as a
--      digest. It is the one credential in this product, and it is not a
--      password: it identifies nobody, it cannot be reset by email because
--      there is no email, and losing it costs exactly what losing the device
--      key costs today.
--
-- What this deliberately is not: a username, an email address, a password, a
-- profile, or anything that could be used to find a person. A signature is
-- still a drawn mark. This only makes the mark portable.

-- ------------------------------------------------- where pgcrypto actually is
--
-- The recovery key is hashed with `digest` and generated with
-- `gen_random_bytes`, both of which are pgcrypto rather than core. 0001 asks
-- for pgcrypto with no schema, so on a bare PostgreSQL it lands in `public`
-- and everything below resolves. On Supabase pgcrypto is already installed
-- into `extensions` before the first migration runs, `if not exists` is a
-- no-op, and a function pinned to `set search_path = public` cannot see it.
--
-- That difference is invisible until somebody taps "get a recovery key" and
-- gets `function digest(unknown, unknown) does not exist` — the migration
-- applies perfectly, because plpgsql does not resolve function names in a body
-- until it runs one. So the two functions that need pgcrypto name both schemas,
-- and this block fails the migration now rather than failing a person later.
do $$
declare
  path constant text := 'public, extensions';
  was  text := current_setting('search_path');
begin
  perform set_config('search_path', path, true);
  if to_regprocedure('digest(text, text)') is null then
    raise exception 'pgcrypto''s digest() is not reachable from "%" — a recovery key could not be hashed', path;
  end if;
  if to_regprocedure('gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto''s gen_random_bytes() is not reachable from "%" — a recovery key could not be minted', path;
  end if;
  perform set_config('search_path', was, true);
end $$;

-- --------------------------------------------------------------- the device set

create table if not exists public.signature_devices (
  signature_id uuid not null references public.signatures (id) on delete restrict,
  device_key   text not null,
  added_at     timestamptz not null default now(),
  primary key (signature_id, device_key)
);

-- A device key belongs to one signature. Without this, a stolen key could be
-- attached to a second mark and used to draw as either.
create unique index if not exists signature_devices_key_uniq
  on public.signature_devices (device_key);

alter table public.signature_devices enable row level security;
revoke all on public.signature_devices from anon, authenticated;

-- Everything that already exists keeps working: the column that used to be the
-- whole of authorship becomes the first row in the set.
insert into public.signature_devices (signature_id, device_key, added_at)
select id, device_key, created_at from public.signatures
on conflict do nothing;

/**
 * Does this browser hold this mark?
 *
 * One place, because it is asked in four and a check that drifts between them
 * is a hole that only shows up in the one that was forgotten. The legacy column
 * is still consulted: a signature created between this migration running and
 * the client deploy that follows it would otherwise be unable to draw.
 */
create or replace function public.owns_signature(
  p_signature  uuid,
  p_device_key text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.signature_devices
     where signature_id = p_signature and device_key = p_device_key
  ) or exists (
    select 1 from public.signatures
     where id = p_signature and device_key = p_device_key
  )
$$;

revoke execute on function public.owns_signature(uuid, text) from public, anon, authenticated;

-- Keeps the set in step for marks created by the plain insert the client still
-- uses to sign. A trigger rather than a change to the client, because the row
-- and its membership have to arrive together or not at all.
create or replace function public.signatures_register_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.signature_devices (signature_id, device_key)
  values (new.id, new.device_key)
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists signatures_register_device_trg on public.signatures;
create trigger signatures_register_device_trg
  after insert on public.signatures
  for each row execute function public.signatures_register_device();

revoke execute on function public.signatures_register_device()
  from public, anon, authenticated;

-- ------------------------------------------------------------ the recovery key

alter table public.signatures
  add column if not exists recovery_hash bytea,
  add column if not exists recovery_set_at timestamptz;

create unique index if not exists signatures_recovery_uniq
  on public.signatures (recovery_hash) where recovery_hash is not null;

comment on column public.signatures.recovery_hash is
  'sha256 of the recovery key. The key itself is returned once, at mint, and '
  'is never stored or recoverable — losing it costs what losing the device '
  'key costs, which is the mark.';

/**
 * Mints a recovery key and hands it back exactly once.
 *
 * Generated server-side rather than by the client, because the client's
 * randomness is whatever the browser gives it and this is the only thing
 * standing between somebody and their own work. Hex in groups of five, because
 * it will be copied by hand at least sometimes, and an alphabet with no O/0 or
 * l/1 confusion is worth more than the density.
 *
 * Minting again replaces the old one, which is also how you revoke a key you
 * wrote down somewhere you regret.
 */
create or replace function public.mint_recovery_key(
  p_signature  uuid,
  p_device_key text
)
returns text
language plpgsql
security definer
-- `extensions` because that is where Supabase keeps pgcrypto; see the check at
-- the top of this file. Harmless on a bare PostgreSQL, where the schema does
-- not exist and a search_path entry naming a missing schema is simply skipped.
set search_path = public, extensions
as $$
declare
  raw text;
  key text;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  raw := encode(gen_random_bytes(15), 'hex');
  key := 'lh-' || substr(raw, 1, 5) || '-' || substr(raw, 6, 5) || '-' ||
         substr(raw, 11, 5) || '-' || substr(raw, 16, 5) || '-' ||
         substr(raw, 21, 5) || '-' || substr(raw, 26, 5);

  update public.signatures
     set recovery_hash = digest(key, 'sha256'),
         recovery_set_at = now()
   where id = p_signature;

  return key;
end
$$;

/**
 * Attaches this browser to the mark that key belongs to.
 *
 * The key is not consumed. Somebody with two phones and a laptop should not
 * have to mint a new key for each, and a key that stops working after one use
 * is a key people lose confidence in and stop keeping.
 */
create or replace function public.redeem_recovery_key(
  p_key        text,
  p_device_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions   -- pgcrypto's digest(); see the top of this file
as $$
declare
  sig uuid;
begin
  if p_device_key is null or length(p_device_key) < 8 then
    raise exception 'a device key is required';
  end if;

  select id into sig
    from public.signatures
   where recovery_hash = digest(coalesce(p_key, ''), 'sha256');

  if sig is null then
    raise exception 'that key does not match a mark';
  end if;

  insert into public.signature_devices (signature_id, device_key)
  values (sig, p_device_key)
  on conflict (device_key) do update set signature_id = excluded.signature_id;

  return sig;
end
$$;

revoke execute on function public.mint_recovery_key(uuid, text) from public;
revoke execute on function public.redeem_recovery_key(text, text) from public;
grant execute on function public.mint_recovery_key(uuid, text) to anon, authenticated;
grant execute on function public.redeem_recovery_key(text, text) to anon, authenticated;

comment on function public.redeem_recovery_key(text, text) is
  'Binds a browser to a mark. SECURITY DEFINER and anon-executable on purpose: '
  'there are no accounts, so the key is the only thing that can prove this.';

-- ------------------------------------------- the four places authorship is asked

-- Every one of these had the same `exists (... device_key = ...)` inline. They
-- now ask owns_signature, so adding a device works everywhere at once and the
-- rule cannot drift between them.

create or replace function public.claim_turn(
  p_signature  uuid,
  p_device_key text,
  p_minutes    int default 10,
  p_slots      int default null
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
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that signature does not belong to this browser';
  end if;
  if p_slots is not null and not exists (
    select 1 from public.canvas_formats where slot_count = p_slots
  ) then
    raise exception 'there is no % hand format', p_slots;
  end if;

  perform public.sweep_expired_turns();

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

    select * into c
      from public.canvases
     where status <> 'closed'
       and slots_filled < slot_count
       and (p_slots is null or canvases.slot_count = p_slots)
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
     order by (canvases.slot_count - canvases.slots_filled), created_at
     limit 1
     for update;

    if not found then
      insert into public.canvases (seed_word, slot_count)
      values (public.pick_seed(), coalesce(p_slots, public.pick_format())::smallint)
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
   where t.id = p_turn
     and t.state = 'active'
     and public.owns_signature(t.signature_id, p_device_key);
  get diagnostics n = row_count;
  return n > 0;
end
$$;

-- ------------------------------------------------------------------- grants

revoke execute on function public.claim_turn(uuid, text, int, int) from public;
revoke execute on function public.submit_turn(uuid, jsonb, integer, text) from public;
revoke execute on function public.release_turn(uuid, text) from public;
grant execute on function public.claim_turn(uuid, text, int, int) to anon, authenticated;
grant execute on function public.submit_turn(uuid, jsonb, integer, text) to anon, authenticated;
grant execute on function public.release_turn(uuid, text) to anon, authenticated;
