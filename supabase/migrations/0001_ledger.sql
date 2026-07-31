-- Longhand milestone 2 — the ledger.
--
-- Strokes are stored as vectors, never pixels. That single decision is what
-- later gives the timelapse, the isolated-layer card, layer-hide moderation and
-- print-resolution output, all from one source of truth.
--
-- The brief's hard rule is that nothing is ever deleted from the ledger, only
-- hidden. That is enforced here in the database with a trigger rather than left
-- to application politeness, because an append-only archive that depends on
-- every future caller behaving is not append-only.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- seeds

create table if not exists public.seeds (
  word text primary key
);

insert into public.seeds (word) values
  ('harbour'), ('orchard'), ('migration'), ('the long way home'),
  ('weather'), ('a room at night'), ('threshold'), ('low tide'),
  ('signal'), ('archive'), ('the last warm day'), ('crossing')
on conflict do nothing;

create or replace function public.pick_seed()
returns text
language sql
volatile
set search_path = public
as $$
  select word from public.seeds order by random() limit 1
$$;

-- ----------------------------------------------------------- signatures

-- Identity is a drawn mark. There is no username column here and there never
-- will be. device_key is a random id the client generates and keeps in local
-- storage — deliberately not a fingerprint, so it identifies a browser the
-- player controls and nothing about the person.
create table if not exists public.signatures (
  id uuid primary key default gen_random_uuid(),
  stroke_data jsonb not null,
  device_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists signatures_device_key_idx
  on public.signatures (device_key);

-- ------------------------------------------------------------- canvases

create table if not exists public.canvases (
  id uuid primary key default gen_random_uuid(),
  seed_word text not null,
  slot_count smallint not null default 12,
  slots_filled smallint not null default 0,
  status text not null default 'open'
    check (status in ('open', 'in_turn', 'closed')),
  -- Every colour used so far. This is the input to palette inheritance:
  -- each player after slot 1 gets these plus two new ones.
  palette jsonb not null default '[]'::jsonb,
  snapshot_url text,
  timelapse_url text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists canvases_status_idx
  on public.canvases (status, created_at);

-- --------------------------------------------------------------- layers

create table if not exists public.layers (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references public.canvases (id) on delete restrict,
  slot_index smallint not null,
  signature_id uuid not null references public.signatures (id) on delete restrict,
  -- The encoded layer: { v, w, h, strokes: [{ c, s, t, i, p: [x,y,w,dt,...] }] }
  strokes jsonb not null,
  ink_used integer not null default 0,
  hidden boolean not null default false,
  submitted_at timestamptz not null default now(),
  unique (canvas_id, slot_index)
);

create index if not exists layers_canvas_idx
  on public.layers (canvas_id, slot_index);

-- Append-only, enforced. A layer may only ever change its `hidden` flag;
-- moderation hides, it does not erase, and no row ever leaves this table.
create or replace function public.layers_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'layers are append-only: hide the layer, do not delete it';
  end if;

  if new.id            is distinct from old.id
  or new.canvas_id     is distinct from old.canvas_id
  or new.slot_index    is distinct from old.slot_index
  or new.signature_id  is distinct from old.signature_id
  or new.strokes       is distinct from old.strokes
  or new.ink_used      is distinct from old.ink_used
  or new.submitted_at  is distinct from old.submitted_at then
    raise exception 'layers are immutable except for the hidden flag';
  end if;

  return new;
end
$$;

drop trigger if exists layers_append_only_trg on public.layers;
create trigger layers_append_only_trg
  before update or delete on public.layers
  for each row execute function public.layers_append_only();

-- ---------------------------------------------------------------- turns

-- Unused until milestone 3, created now so the model is whole and the
-- foreign keys settle before there is data to migrate.
create table if not exists public.turns (
  id uuid primary key default gen_random_uuid(),
  canvas_id uuid not null references public.canvases (id) on delete restrict,
  slot_index smallint not null,
  signature_id uuid not null references public.signatures (id) on delete restrict,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state text not null default 'active'
    check (state in ('active', 'submitted', 'expired'))
);

create index if not exists turns_sweep_idx
  on public.turns (state, expires_at);

-- ------------------------------------------------------------------ rpc

-- Hands back the canvas a player should join, creating one if every canvas is
-- full. The advisory lock serialises creation so a burst of arrivals joins one
-- new canvas instead of opening a dozen empty ones.
create or replace function public.open_or_join_canvas()
returns public.canvases
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.canvases;
begin
  perform pg_advisory_xact_lock(hashtext('longhand.open_canvas'));

  select * into c
    from public.canvases
   where status <> 'closed'
     and slots_filled < slot_count
   order by created_at
   limit 1;

  if not found then
    insert into public.canvases (seed_word)
    values (public.pick_seed())
    returning * into c;
  end if;

  return c;
end
$$;

-- Appends a layer and closes the canvas when the last slot lands. The row lock
-- is what stops two players from ever being handed the same slot index.
create or replace function public.submit_layer(
  p_canvas    uuid,
  p_signature uuid,
  p_strokes   jsonb,
  p_ink       integer
)
returns public.layers
language plpgsql
security definer
set search_path = public
as $$
declare
  c   public.canvases;
  l   public.layers;
  idx smallint;
begin
  select * into c from public.canvases where id = p_canvas for update;
  if not found then
    raise exception 'no such canvas: %', p_canvas;
  end if;
  if c.status = 'closed' or c.slots_filled >= c.slot_count then
    raise exception 'canvas % is closed', p_canvas;
  end if;
  if jsonb_array_length(coalesce(p_strokes -> 'strokes', '[]'::jsonb)) = 0 then
    raise exception 'a layer must contain at least one stroke';
  end if;

  idx := c.slots_filled + 1;

  insert into public.layers
    (canvas_id, slot_index, signature_id, strokes, ink_used)
  values
    (p_canvas, idx, p_signature, p_strokes, greatest(0, coalesce(p_ink, 0)))
  returning * into l;

  update public.canvases
     set slots_filled = idx,
         status       = case when idx >= c.slot_count then 'closed' else 'open' end,
         closed_at    = case when idx >= c.slot_count then now() else null end,
         palette      = (
           select coalesce(jsonb_agg(distinct col), '[]'::jsonb)
             from (
               select jsonb_array_elements_text(c.palette) as col
               union
               select s.value ->> 'c'
                 from jsonb_array_elements(p_strokes -> 'strokes') s
             ) u
            where col is not null
         )
   where id = p_canvas;

  return l;
end
$$;

-- ------------------------------------------------------------------ rls

alter table public.seeds      enable row level security;
alter table public.signatures enable row level security;
alter table public.canvases   enable row level security;
alter table public.layers     enable row level security;
alter table public.turns      enable row level security;

-- Signatures are public marks — they appear on the artwork. Anyone may add one
-- and anyone may read one. Nobody may change or remove one.
drop policy if exists signatures_read on public.signatures;
create policy signatures_read on public.signatures
  for select to anon, authenticated using (true);

drop policy if exists signatures_add on public.signatures;
create policy signatures_add on public.signatures
  for insert to anon, authenticated with check (
    jsonb_array_length(coalesce(stroke_data -> 'strokes', '[]'::jsonb)) between 1 and 400
    and length(device_key) between 8 and 128
  );

-- Canvases are readable by everyone; they are only ever written through the
-- security-definer functions above, which bypass RLS.
drop policy if exists canvases_read on public.canvases;
create policy canvases_read on public.canvases
  for select to anon, authenticated using (true);

-- Hidden layers stay in the table forever but stop being served.
drop policy if exists layers_read on public.layers;
create policy layers_read on public.layers
  for select to anon, authenticated using (hidden = false);

drop policy if exists turns_read on public.turns;
create policy turns_read on public.turns
  for select to anon, authenticated using (true);

-- No policy is defined for insert/update/delete on canvases, layers or turns,
-- so those are denied outright to clients. Writes go through the functions.

revoke all on function public.open_or_join_canvas() from public;
revoke all on function public.submit_layer(uuid, uuid, jsonb, integer) from public;
grant execute on function public.open_or_join_canvas() to anon, authenticated;
grant execute on function public.submit_layer(uuid, uuid, jsonb, integer) to anon, authenticated;
