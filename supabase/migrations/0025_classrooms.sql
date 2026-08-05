-- Classrooms.
--
-- Where the idea came from, the strongest early market, and the one place this
-- product has to behave differently — because a public canvas that strangers
-- draw on is not something a teacher can supervise, and the safety position
-- written in Phase A says so out loud.
--
-- A classroom canvas is the same canvas with two differences: strangers are
-- never sent to it by the relay, and it never appears in the gallery. Getting
-- in takes a code the teacher reads out. That is the whole mechanism — no
-- accounts for children, no email addresses, no names, nothing collected that
-- could identify anybody, which is exactly what makes it usable in a school.
--
-- The teacher is not an account either. A classroom is held by a key their
-- browser keeps, the same way a mark is, and the recovery key from 0021 is how
-- it survives a new laptop.

create table if not exists public.classrooms (
  id         uuid primary key default gen_random_uuid(),
  -- What the teacher calls it. The only free text in this schema, visible only
  -- to the class, and never attached to a person.
  name       text not null check (length(name) between 1 and 60),
  -- Read out loud, typed once. Short enough for a whiteboard.
  code       text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  owner_id   uuid not null references public.signatures (id) on delete restrict,
  created_at timestamptz not null default now(),
  archived   boolean not null default false
);

create index if not exists classrooms_owner_idx on public.classrooms (owner_id);

alter table public.classrooms enable row level security;
revoke all on public.classrooms from anon, authenticated;

alter table public.canvases
  add column if not exists classroom_id uuid references public.classrooms (id);

create index if not exists canvases_classroom_idx
  on public.canvases (classroom_id) where classroom_id is not null;

comment on column public.canvases.classroom_id is
  'Set makes a canvas private to one class: the open relay never sends a '
  'stranger to it and the gallery never lists it. Reachable at its own URL by '
  'anyone the class shares it with, exactly like an unlisted canvas.';

-- The relay's one question about privacy, answered properly now. 0023 defined
-- this as a stand-in returning true so claim_turn would not need rewriting
-- twice.
create or replace function public.canvas_is_open_to_strangers(p_canvas uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select classroom_id is null from public.canvases where id = p_canvas),
    false)
$$;

-- And the gallery's. Classroom work is the class's, and putting a child's
-- drawing on a public shelf because a teacher forgot a checkbox is not a
-- mistake this should be able to make.
create or replace function public.fetch_gallery(p_limit int default 40)
returns setof public.canvases
language sql
stable
set search_path = public
as $$
  select * from public.canvases
   where status = 'closed' and listed and classroom_id is null
   order by closed_at desc
   limit greatest(1, least(p_limit, 200))
$$;

revoke execute on function public.fetch_gallery(int) from public;
grant execute on function public.fetch_gallery(int) to anon, authenticated;

-- ------------------------------------------------------------- the mechanics

/**
 * Opens a classroom. Anybody can: a teacher should not have to be granted
 * anything by us before their Tuesday afternoon works.
 */
create or replace function public.open_classroom(
  p_name       text,
  p_signature  uuid,
  p_device_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c      public.classrooms;
  -- Not `code`: plpgsql would read the unqualified column of the same name in
  -- the uniqueness check below as this variable, and the loop would compare a
  -- value to itself and exit on the first try.
  v_code text;
  n      int := 0;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  loop
    n := n + 1;
    -- No I, O, 0 or 1: this gets read off a whiteboard by a room of children.
    v_code := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               1 + floor(random() * 32)::int, 1), '')
        from generate_series(1, 6)
    );
    exit when not exists (select 1 from public.classrooms cl where cl.code = v_code);
    if n > 20 then raise exception 'could not find a free code'; end if;
  end loop;

  insert into public.classrooms (name, code, owner_id)
  values (p_name, v_code, p_signature)
  returning * into c;

  return to_jsonb(c);
end
$$;

/**
 * Opens a canvas inside a classroom, and hands slot 1 to whoever asked.
 *
 * The teacher chooses the size, because a class has a known number of children
 * in it — which is the one situation where the format is not a guess.
 */
create or replace function public.open_classroom_canvas(
  p_code       text,
  p_signature  uuid,
  p_device_key text,
  p_slots      int default 24,
  p_seed       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room public.classrooms;
  c    public.canvases;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  select * into room from public.classrooms where code = upper(p_code) and not archived;
  if not found then raise exception 'no classroom with that code'; end if;
  if room.owner_id <> p_signature then
    raise exception 'only the person who opened the classroom can start a canvas in it';
  end if;
  if not exists (select 1 from public.canvas_formats where slot_count = p_slots) then
    raise exception 'there is no % hand format', p_slots;
  end if;

  insert into public.canvases (seed_word, slot_count, classroom_id, listed)
  values (coalesce(p_seed, public.pick_seed()), p_slots::smallint, room.id, false)
  returning * into c;

  return to_jsonb(c);
end
$$;

/**
 * Joins the class's current canvas with the code.
 *
 * Deliberately not `claim_turn` with an extra argument. A classroom join is a
 * different act — it names a room rather than asking for whatever is going —
 * and keeping it separate means the open relay has no code path that could
 * ever hand a stranger a classroom slot by accident.
 */
create or replace function public.claim_classroom_turn(
  p_code       text,
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
  room public.classrooms;
  c    public.canvases;
  t    public.turns;
  idx  smallint;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  select * into room from public.classrooms where code = upper(p_code) and not archived;
  if not found then raise exception 'no classroom with that code'; end if;

  perform public.sweep_expired_turns();

  select * into t
    from public.turns
   where signature_id = p_signature and state = 'active' and expires_at > now()
   limit 1;
  if found then
    select * into c from public.canvases where id = t.canvas_id;
    return jsonb_build_object('turn', to_jsonb(t), 'canvas', to_jsonb(c), 'resumed', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('longhand.classroom.' || room.id::text));

  select * into c
    from public.canvases
   where classroom_id = room.id
     and status <> 'closed'
     and slots_filled < slot_count
     and not exists (select 1 from public.layers l
                      where l.canvas_id = canvases.id and l.signature_id = p_signature)
     and exists (select 1 from generate_series(1, canvases.slot_count) gs
                  where public.slot_is_free(canvases.id, gs))
   order by created_at
   limit 1
   for update;

  if not found then
    raise exception 'that class has no canvas with a free place on it right now';
  end if;

  select gs into idx from generate_series(1, c.slot_count) gs
   where public.slot_is_free(c.id, gs) order by gs limit 1;

  insert into public.turns
    (canvas_id, slot_index, signature_id, expires_at, state, palette)
  values
    (c.id, idx, p_signature, now() + make_interval(mins => p_minutes), 'active',
     public.inherited_palette(c.palette, c.id::text))
  returning * into t;

  return jsonb_build_object('turn', to_jsonb(t), 'canvas', to_jsonb(c), 'resumed', false);
end
$$;

/** What a teacher sees: their rooms and what is happening in each. */
create or replace function public.my_classrooms(p_signature uuid, p_device_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  return (
    select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb) from (
      select r.created_at, jsonb_build_object(
               'id', r.id, 'name', r.name, 'code', r.code,
               'canvases', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', c.id, 'seed', c.seed_word, 'status', c.status,
                          'slots', c.slot_count, 'filled', c.slots_filled)
                        order by c.created_at desc), '[]'::jsonb)
                   from public.canvases c where c.classroom_id = r.id)
             ) as row
        from public.classrooms r
       where r.owner_id = p_signature and not r.archived
    ) q
  );
end
$$;

revoke execute on function public.open_classroom(text, uuid, text) from public;
revoke execute on function public.open_classroom_canvas(text, uuid, text, int, text) from public;
revoke execute on function public.claim_classroom_turn(text, uuid, text, int) from public;
revoke execute on function public.my_classrooms(uuid, text) from public;

grant execute on function public.open_classroom(text, uuid, text) to anon, authenticated;
grant execute on function public.open_classroom_canvas(text, uuid, text, int, text) to anon, authenticated;
grant execute on function public.claim_classroom_turn(text, uuid, text, int) to anon, authenticated;
grant execute on function public.my_classrooms(uuid, text) to anon, authenticated;
