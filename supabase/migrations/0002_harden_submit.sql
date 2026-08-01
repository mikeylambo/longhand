-- Hardening the one write endpoint the public can reach.
--
-- v1 has no accounts, so `open_or_join_canvas` and `submit_layer` must stay
-- callable by `anon` — that is the product, not an oversight. The database
-- linter will keep flagging them; this migration is the answer to that flag.
-- What it fixes is the two things that were genuinely wrong:
--
--   1. `submit_layer` accepted a jsonb blob of any size. A public endpoint that
--      writes unbounded rows is a storage bill waiting to happen.
--   2. `submit_layer` took `p_signature` on trust, so anyone could attribute a
--      drawing to another player's mark. In an archive that is meant to last,
--      false attribution is the worst kind of corruption — it can be hidden but
--      never removed.
--
-- The fix for (2) is possession of the device key that created the signature.
-- Not cryptographic, but it means spoofing requires stealing a value that never
-- leaves the owner's browser — so the column is taken out of the client's
-- reach below.

-- device_key must not be readable, or the check it guards is theatre.
revoke select (device_key) on public.signatures from anon, authenticated;

-- A full layer at the current 14000px ink budget encodes to roughly 60 KB.
-- 2 MB is thirty times that, and still a hard ceiling.
create or replace function public.submit_layer(
  p_canvas     uuid,
  p_signature  uuid,
  p_strokes    jsonb,
  p_ink        integer,
  p_device_key text
)
returns public.layers
language plpgsql
security definer
set search_path = public
as $$
declare
  c        public.canvases;
  l        public.layers;
  idx      smallint;
  n_strokes int;
begin
  if p_device_key is null or length(p_device_key) < 8 then
    raise exception 'a device key is required to sign a layer';
  end if;

  if not exists (
    select 1 from public.signatures
     where id = p_signature and device_key = p_device_key
  ) then
    raise exception 'that signature does not belong to this browser';
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

  select * into c from public.canvases where id = p_canvas for update;
  if not found then
    raise exception 'no such canvas: %', p_canvas;
  end if;
  if c.status = 'closed' or c.slots_filled >= c.slot_count then
    raise exception 'canvas % is closed', p_canvas;
  end if;

  idx := c.slots_filled + 1;

  insert into public.layers
    (canvas_id, slot_index, signature_id, strokes, ink_used)
  values
    (p_canvas, idx, p_signature, p_strokes,
     least(1000000, greatest(0, coalesce(p_ink, 0))))
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

-- The four-argument version is gone; nothing may call the unguarded path.
drop function if exists public.submit_layer(uuid, uuid, jsonb, integer);

revoke all on function public.submit_layer(uuid, uuid, jsonb, integer, text) from public;
grant execute on function public.submit_layer(uuid, uuid, jsonb, integer, text)
  to anon, authenticated;

comment on function public.submit_layer(uuid, uuid, jsonb, integer, text) is
  'Appends a layer under a row lock. SECURITY DEFINER and anon-executable on '
  'purpose: v1 has no accounts. Authorship is bound to the device key that '
  'created the signature.';

comment on function public.open_or_join_canvas() is
  'Returns the canvas a player should join, creating one only when every canvas '
  'is full. SECURITY DEFINER and anon-executable on purpose: v1 has no accounts. '
  'Repeated calls cannot create canvases.';

comment on table public.seeds is
  'RLS is enabled with no policy on purpose: seeds are read only by pick_seed() '
  'inside a SECURITY DEFINER function, never by a client.';
