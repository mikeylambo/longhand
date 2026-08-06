-- A floor under claiming, before the link is public.
--
-- One active turn per signature was already enforced — `claim_turn` resumes an
-- existing turn rather than issuing a second — so no single mark can hold two
-- slots. What had no floor was making marks: a signature is one insert with a
-- drawn squiggle, and nothing stopped a browser minting a hundred of them and
-- taking a slot with each. That is the whole of the abuse surface for a
-- product with no accounts.
--
-- Nothing the client sends can be trusted to identify a person, so this uses
-- the one thing it does not control: the address the platform saw. PostgREST
-- exposes the request headers to a definer function, which is the only place
-- that value exists.
--
-- Three things about doing that carefully.
--
-- The address is never stored. It is salted with a secret this database
-- generated for itself and kept as a digest, and rows older than the window
-- are deleted on every call. That keeps the anti-abuse property without the
-- product starting to keep a record of who visited, which it has never done
-- and which would be a strange thing to trade for this.
--
-- Classrooms are deliberately not throttled. `claim_classroom_turn` is a
-- separate function and does not call this. Twenty-four children on one school
-- connection are one address, and an IP limit that did not know the difference
-- would break the classroom feature completely while looking like it was
-- working.
--
-- And the limit is a row, not a constant. `canvas_formats` set the precedent:
-- anything an operator might need to change at 9pm on a Saturday should not be
-- a deploy.

create table if not exists public.claim_limits (
  id             smallint primary key default 1 check (id = 1),
  per_window     int  not null default 30,
  window_minutes int  not null default 60,
  -- Generated here and never read by anything but the digest below, so the
  -- stored hashes cannot be reversed by anyone holding a copy of the table
  -- without also holding this row.
  salt           bytea not null default extensions.gen_random_bytes(32)
);

insert into public.claim_limits (id) values (1) on conflict (id) do nothing;

alter table public.claim_limits enable row level security;
revoke all on public.claim_limits from anon, authenticated;

create table if not exists public.claim_attempts (
  ip_hash    bytea       not null,
  claimed_at timestamptz not null default now()
);

create index if not exists claim_attempts_lookup
  on public.claim_attempts (ip_hash, claimed_at desc);

alter table public.claim_attempts enable row level security;
revoke all on public.claim_attempts from anon, authenticated;

comment on table public.claim_attempts is
  'Salted digests of the addresses that recently claimed a slot, kept only for '
  'the length of the rate window. Never the address itself.';

/**
 * The caller's address, as a digest, or null when there is not one to be had.
 *
 * Null happens whenever this is reached other than through PostgREST — psql, a
 * migration, the SQL editor — and it means the limit does not apply. That is
 * the right answer for those callers and a silent hole if it were ever the
 * answer for a real request, which is what `claim_throttle_health` is for.
 */
create or replace function public.caller_fingerprint()
returns bytea
language plpgsql
stable
security definer
set search_path = public, extensions   -- pgcrypto's digest lives in extensions
as $$
declare
  fwd  text;
  addr text;
  s    bytea;
begin
  fwd := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  if fwd is null or btrim(fwd) = '' then
    return null;
  end if;
  -- First entry is the client as the edge saw it; the rest are proxies.
  addr := btrim(split_part(fwd, ',', 1));
  if addr = '' then
    return null;
  end if;

  select salt into s from public.claim_limits where id = 1;
  return digest(s || addr::bytea, 'sha256');
exception
  when others then
    -- A malformed header must never be the reason somebody cannot draw.
    return null;
end
$$;

/**
 * Records a claim and refuses one too many.
 *
 * Called by `claim_turn` only. Prunes as it goes, so the table stays the size
 * of one window rather than growing forever — there is no cron job here to
 * forget about.
 */
create or replace function public.note_claim_attempt()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fp     bytea;
  lim    public.claim_limits;
  recent int;
begin
  fp := public.caller_fingerprint();
  if fp is null then
    return;
  end if;

  select * into lim from public.claim_limits where id = 1;

  delete from public.claim_attempts
   where claimed_at < now() - make_interval(mins => lim.window_minutes);

  select count(*) into recent
    from public.claim_attempts
   where ip_hash = fp
     and claimed_at > now() - make_interval(mins => lim.window_minutes);

  if recent >= lim.per_window then
    -- Says what happened and that it passes, because the alternative reads as
    -- the product being broken and this is the one refusal an ordinary person
    -- could conceivably hit.
    raise exception 'that is a lot of slots in a short time — give the ones you have a few minutes'
      using errcode = 'check_violation';
  end if;

  insert into public.claim_attempts (ip_hash) values (fp);
end
$$;

/**
 * Whether the throttle is seeing anything at all.
 *
 * The failure mode worth catching is not the limit firing, it is the limit
 * never firing because no address ever arrives — a change to how requests
 * reach the database would turn this off silently and nothing else would
 * notice. `addresses_seen` staying at zero while people are drawing is the
 * tell.
 */
create or replace function public.claim_throttle_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'per_window',     (select per_window from public.claim_limits where id = 1),
    'window_minutes', (select window_minutes from public.claim_limits where id = 1),
    'attempts_in_window', (select count(*) from public.claim_attempts),
    'addresses_seen',     (select count(distinct ip_hash) from public.claim_attempts),
    'busiest',            (select max(n) from (
                             select count(*) n from public.claim_attempts group by ip_hash
                           ) q)
  )
$$;

revoke execute on function public.caller_fingerprint() from public, anon, authenticated;
revoke execute on function public.note_claim_attempt() from public, anon, authenticated;
revoke execute on function public.claim_throttle_health() from public, anon, authenticated;
grant execute on function public.claim_throttle_health() to service_role;

-- ------------------------------------------------------------------- claim
--
-- Unchanged from 0023 apart from one line: the throttle is checked after the
-- turn is known not to be a resume, so somebody reloading the page they are
-- already drawing on never counts against it. Resuming is not claiming.

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

  -- Past this point a new slot is genuinely being taken.
  perform public.note_claim_attempt();

  perform pg_advisory_xact_lock(hashtext('longhand.claim'));

  loop
    attempts := attempts + 1;
    exit when attempts > 8;

    select * into c
      from public.canvases
     where status <> 'closed'
       and slots_filled < slot_count
       and (p_slots is null or canvases.slot_count = p_slots)
       and public.canvas_is_open_to_strangers(canvases.id)
       and not exists (
         select 1 from public.layers l
          where l.canvas_id = canvases.id and l.signature_id = p_signature
       )
       and exists (
         select 1 from generate_series(1, canvases.slot_count) gs
          where public.slot_is_free(canvases.id, gs)
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
     where public.slot_is_free(c.id, gs)
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

-- Proves the pieces work as the role that will run them, inside the migration.
-- Cannot prove the limit itself fires — that needs a request with an address,
-- which a migration does not have — so it proves the part that would otherwise
-- be assumed: that a caller with no address is let through rather than blocked.
do $$
begin
  if public.caller_fingerprint() is not null then
    raise exception 'a migration should have no request address';
  end if;
  perform public.note_claim_attempt();
  if (select count(*) from public.claim_attempts) <> 0 then
    raise exception 'an addressless caller was recorded against the limit';
  end if;
end $$;
