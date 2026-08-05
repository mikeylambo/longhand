-- Duos and quartets, alongside twelves.
--
-- `slot_count` has been a column rather than a constant since 0001, so the
-- engine, the close condition, the gallery and the video already handle any
-- number. This migration is the part that was missing: a canvas can now be
-- *opened* at something other than twelve, and a player can ask for one.
--
-- The reason is cold start, not variety. With a small population a twelve-slot
-- canvas may never close, so a stranger draws, submits, and experiences one
-- twelfth of the product — no finished artwork, no timelapse, no video, no
-- hand isolated on bare paper. A duo closes with one other person, plausibly
-- the same day. That turns a partial experience into a whole one, and it costs
-- almost nothing because the machinery is already here.
--
-- Formats live in a table rather than a check constraint for the same reason
-- the palette does: adding the classroom format later must not require a client
-- deploy, and the operator has to be able to see the list.

-- ------------------------------------------------------------------ formats

create table if not exists public.canvas_formats (
  slot_count smallint primary key,
  -- For the operator and the moderation queue. The client carries its own
  -- copy of these names for typography's sake; tests/ledger.spec.ts asserts
  -- the two never drift.
  label      text not null,
  -- Share of *newly opened* canvases, when the player did not ask for a
  -- format. Twelve is the flagship and duos are the cold-start fix, so the
  -- rotation opens two duos and one quartet for every twelve.
  weight     smallint not null default 1 check (weight >= 0)
);

insert into public.canvas_formats (slot_count, label, weight) values
  (2,  'duo',      2),
  (4,  'quartet',  1),
  (12, 'twelve',   1)
on conflict (slot_count) do update
  set label = excluded.label, weight = excluded.weight;

alter table public.canvas_formats enable row level security;

drop policy if exists formats_read on public.canvas_formats;
create policy formats_read on public.canvas_formats
  for select to anon, authenticated using (true);

grant select on public.canvas_formats to anon, authenticated;

-- A canvas cannot be opened at a size that is not a format. Every existing
-- canvas is a twelve, which is in the table above, so this constrains without
-- rewriting anything.
alter table public.canvases
  drop constraint if exists canvases_slot_count_fk;
alter table public.canvases
  add constraint canvases_slot_count_fk
  foreign key (slot_count) references public.canvas_formats (slot_count);

comment on table public.canvas_formats is
  'The sizes a canvas may be opened at. `weight` is the share of new canvases '
  'opened at that size when the player expressed no preference.';

-- --------------------------------------------------------------- the rotation

/**
 * Which format to open next, when nobody asked.
 *
 * Deterministic and stateless: position in the rotation is the number of
 * canvases that exist, so there is no counter to drift and no randomness to
 * make a burst of arrivals open twelve twelves. With the weights above the
 * sequence is duo, duo, quartet, twelve — small enough that a lone stranger's
 * canvas can actually close, without the twelve disappearing from the archive.
 */
create or replace function public.pick_format()
returns smallint
language plpgsql
volatile
set search_path = public
as $$
declare
  total  int;
  n      bigint;
  chosen smallint;
begin
  select coalesce(sum(weight), 0) into total from public.canvas_formats;
  -- Every weight set to zero is a deliberate "stop opening new canvases at
  -- anything but the default", not a reason to fail a claim.
  if total = 0 then
    return 12::smallint;
  end if;

  select count(*) into n from public.canvases;

  select s.slot_count into chosen
    from (
      select f.slot_count, g
        from public.canvas_formats f,
             lateral generate_series(1, f.weight) g
    ) s
   order by s.slot_count, s.g
   offset (n % total)
   limit 1;

  return chosen;
end
$$;

revoke execute on function public.pick_format() from public, anon, authenticated;

-- ------------------------------------------------------------------- claim

-- The old three-argument form has to go rather than sit alongside this one:
-- PostgREST resolves an RPC by the argument names in the request body, and
-- `{p_signature, p_device_key}` would match both, which is an error rather
-- than a default.
drop function if exists public.claim_turn(uuid, text, int);

/**
 * Hands the player a slot and starts their clock.
 *
 * Two changes from 0004. A player may name a format, and when they do not,
 * assignment is biased toward the canvas closest to closing rather than the
 * oldest one — so a stranger's hand is the one that finishes something as
 * often as possible. That ordering is a preference, not a promise: remaining
 * slots are counted from what has been submitted, so a canvas whose last free
 * slot is held by a live turn sorts as though it were free. It cannot be
 * *chosen* while that turn lives, because the predicate below excludes it.
 *
 * Reloading still resumes rather than re-claims, and a resumed turn is
 * returned as-is even if the player asked for a different format this time.
 * They are holding a slot; handing them a second one to satisfy a preference
 * is exactly what the resume path exists to prevent.
 */
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
  if not exists (
    select 1 from public.signatures
     where id = p_signature and device_key = p_device_key
  ) then
    raise exception 'that signature does not belong to this browser';
  end if;
  if p_slots is not null and not exists (
    select 1 from public.canvas_formats where slot_count = p_slots
  ) then
    raise exception 'there is no % hand format', p_slots;
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

-- ------------------------------------------------------------------- grants

revoke execute on function public.claim_turn(uuid, text, int, int) from public;
grant execute on function public.claim_turn(uuid, text, int, int) to anon, authenticated;

comment on function public.claim_turn(uuid, text, int, int) is
  'Reserves a slot and starts the turn clock. SECURITY DEFINER and anon-executable on purpose: v1 has no accounts. Bound to the device key that created the signature. p_slots asks for a format; null takes whatever is closest to closing.';
