-- Handing somebody a slot.
--
-- The generous version of the share instinct, and the only invitation
-- mechanic that does not read as spam: you cannot broadcast a gift, you cannot
-- gift to a list, and you get one. A link that means "I saved you a place on
-- this" is a thing a person sends to a person.
--
-- What it deliberately is not: a referral, a reward, an unlock, or anything
-- that gives the giver an advantage. Giving costs you nothing and gains you
-- nothing. There is no counter anywhere of how many you have given.
--
-- The reserved slot is a real hold, so the canvas genuinely waits — which is
-- the whole meaning of the gesture — but it is not held forever. Three days,
-- then it returns to the pool like any other abandoned slot, because a canvas
-- frozen behind somebody who never opened the link is the failure that quietly
-- kills a relay.

create table if not exists public.slot_gifts (
  id            uuid primary key default gen_random_uuid(),
  canvas_id     uuid not null references public.canvases (id) on delete restrict,
  slot_index    smallint not null,
  from_signature uuid not null references public.signatures (id) on delete restrict,
  -- What goes in the link. Long enough that guessing one is not a strategy.
  token         text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  claimed_at    timestamptz,
  claimed_by    uuid references public.signatures (id) on delete restrict
);

-- A slot can only be promised once.
create unique index if not exists slot_gifts_one_per_slot
  on public.slot_gifts (canvas_id, slot_index)
  where claimed_at is null;

-- And one live gift per person, for the same reason a player holds one turn:
-- nobody reserves the board while they think about who to send it to.
create unique index if not exists slot_gifts_one_per_giver
  on public.slot_gifts (from_signature)
  where claimed_at is null;

create index if not exists slot_gifts_live
  on public.slot_gifts (expires_at) where claimed_at is null;

alter table public.slot_gifts enable row level security;
revoke all on public.slot_gifts from anon, authenticated;

/**
 * Reserves the next free slot on a canvas you are on, for whoever opens the
 * link. Returns the token, once.
 *
 * You have to have drawn on the canvas: a gift is a place beside your own
 * work, not a way to hold slots on canvases you have never touched.
 */
create or replace function public.gift_slot(
  p_canvas     uuid,
  p_signature  uuid,
  p_device_key text,
  p_hours      int default 72
)
returns jsonb
language plpgsql
security definer
-- `extensions` for pgcrypto's gen_random_bytes(), which mints the token. See
-- the note at the top of 0021: on Supabase pgcrypto is not in `public`.
set search_path = public, extensions
as $$
declare
  c   public.canvases;
  idx smallint;
  tok text;
  g   public.slot_gifts;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;
  if not exists (
    select 1 from public.layers
     where canvas_id = p_canvas and signature_id = p_signature
  ) then
    raise exception 'you can only give away a place beside your own work';
  end if;

  perform public.sweep_expired_turns();
  delete from public.slot_gifts
   where claimed_at is null and expires_at < now();

  select * into c from public.canvases where id = p_canvas for update;
  if not found then raise exception 'no such canvas'; end if;
  if c.status = 'closed' then raise exception 'that canvas is finished'; end if;

  select gs into idx
    from generate_series(1, c.slot_count) gs
   where not exists (select 1 from public.layers l
                      where l.canvas_id = c.id and l.slot_index = gs)
     and not exists (select 1 from public.turns tt
                      where tt.canvas_id = c.id and tt.slot_index = gs
                        and tt.state = 'active' and tt.expires_at > now())
     and not exists (select 1 from public.slot_gifts sg
                      where sg.canvas_id = c.id and sg.slot_index = gs
                        and sg.claimed_at is null and sg.expires_at > now())
   order by gs
   limit 1;

  if idx is null then
    raise exception 'there is no free slot to give away on that canvas';
  end if;

  tok := replace(encode(gen_random_bytes(18), 'base64'), '/', '-');
  tok := replace(replace(tok, '+', '-'), '=', '');

  insert into public.slot_gifts
    (canvas_id, slot_index, from_signature, token, expires_at)
  values
    (c.id, idx, p_signature, tok, now() + make_interval(hours => p_hours))
  returning * into g;

  return jsonb_build_object('token', tok, 'slot', idx, 'canvas', to_jsonb(c),
                            'expires_at', g.expires_at);
end
$$;

/**
 * Turns a gift into a turn.
 *
 * The recipient gets the ordinary ten minutes from the moment they open it,
 * not the remainder of the gift window — a slot somebody saved for you should
 * not also be a slot that expires while you are looking at it.
 *
 * One hand per canvas still holds. Somebody who has already drawn on that
 * canvas is told so rather than being silently sent elsewhere, because the
 * whole point was *this* canvas.
 */
create or replace function public.redeem_gift(
  p_token      text,
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
  g   public.slot_gifts;
  c   public.canvases;
  t   public.turns;
begin
  if not public.owns_signature(p_signature, p_device_key) then
    raise exception 'that mark does not belong to this browser';
  end if;

  select * into g from public.slot_gifts where token = p_token for update;
  if not found then raise exception 'that invitation does not exist'; end if;
  if g.claimed_at is not null then
    raise exception 'somebody has already taken that place';
  end if;
  if g.expires_at < now() then
    raise exception 'that invitation has run out; the slot went back to the pool';
  end if;
  if g.from_signature = p_signature then
    raise exception 'that is your own invitation to give away';
  end if;
  if exists (
    select 1 from public.layers
     where canvas_id = g.canvas_id and signature_id = p_signature
  ) then
    raise exception 'you have already drawn on that canvas';
  end if;
  if exists (
    select 1 from public.turns
     where signature_id = p_signature and state = 'active' and expires_at > now()
  ) then
    raise exception 'finish the turn you are holding first';
  end if;

  select * into c from public.canvases where id = g.canvas_id for update;
  if c.status = 'closed' then raise exception 'that canvas is finished'; end if;

  insert into public.turns
    (canvas_id, slot_index, signature_id, expires_at, state, palette)
  values
    (c.id, g.slot_index, p_signature, now() + make_interval(mins => p_minutes),
     'active', public.inherited_palette(c.palette, c.id::text))
  returning * into t;

  update public.slot_gifts
     set claimed_at = now(), claimed_by = p_signature
   where id = g.id;

  return jsonb_build_object('turn', to_jsonb(t), 'canvas', to_jsonb(c), 'resumed', false);
end
$$;

/** What the link says before somebody has a mark: which canvas, whose place,
 *  and how long it lasts. Never who gave it — a gift is between two people and
 *  the ledger is not one of them. */
create or replace function public.peek_gift(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'seed',       c.seed_word,
           'slot',       g.slot_index,
           'slot_count', c.slot_count,
           'canvas',     c.id,
           'expires_at', g.expires_at,
           'taken',      g.claimed_at is not null,
           'expired',    g.expires_at < now()
         )
    from public.slot_gifts g
    join public.canvases c on c.id = g.canvas_id
   where g.token = p_token
$$;

-- ------------------------------------------------- claiming must respect them

-- A gifted slot is held. Without this, the next arrival would be handed the
-- very slot somebody just promised to a friend.
create or replace function public.slot_is_free(p_canvas uuid, p_slot int)
returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (select 1 from public.layers l
                      where l.canvas_id = p_canvas and l.slot_index = p_slot)
     and not exists (select 1 from public.turns tt
                      where tt.canvas_id = p_canvas and tt.slot_index = p_slot
                        and tt.state = 'active' and tt.expires_at > now())
     and not exists (select 1 from public.slot_gifts sg
                      where sg.canvas_id = p_canvas and sg.slot_index = p_slot
                        and sg.claimed_at is null and sg.expires_at > now())
$$;

-- A stand-in until 0025 gives canvases a classroom. Replaced there rather than
-- special-cased in claim_turn, so the relay only ever asks one question.
create or replace function public.canvas_is_open_to_strangers(p_canvas uuid)
returns boolean
language sql
stable
set search_path = public
as $$ select true $$;

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
       -- A classroom canvas is private to its class and is never handed out
       -- by the open relay. `classroom_id` arrives in 0025; the column is
       -- referenced through a helper so this function does not have to be
       -- rewritten again for it.
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

revoke execute on function public.gift_slot(uuid, uuid, text, int) from public;
revoke execute on function public.redeem_gift(text, uuid, text, int) from public;
revoke execute on function public.peek_gift(text) from public;
revoke execute on function public.slot_is_free(uuid, int) from public, anon, authenticated;
revoke execute on function public.canvas_is_open_to_strangers(uuid) from public, anon, authenticated;
revoke execute on function public.claim_turn(uuid, text, int, int) from public;

grant execute on function public.gift_slot(uuid, uuid, text, int) to anon, authenticated;
grant execute on function public.redeem_gift(text, uuid, text, int) to anon, authenticated;
grant execute on function public.peek_gift(text) to anon, authenticated;
grant execute on function public.claim_turn(uuid, text, int, int) to anon, authenticated;
