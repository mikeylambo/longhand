-- Nobody could sign.
--
-- 0021 gave every mark a set of devices and put a trigger on `signatures` to
-- keep the set in step with the plain insert the client still uses to sign. The
-- trigger function was left SECURITY INVOKER, so it ran as whoever inserted —
-- which is `anon`, and line 67 of that same migration revokes everything on
-- `signature_devices` from `anon`. Signing therefore raised
--
--     permission denied for table signature_devices
--
-- and, because a trigger's failure rolls back the statement that fired it, the
-- signature row went with it. Not a partial write, not a missing device row:
-- no mark at all, for anyone, from the moment 0021 reached production. The
-- newest signature in the database was the seed.
--
-- The fix is SECURITY DEFINER, which is what the rest of this schema already
-- assumes. It is safe here for a reason worth stating rather than trusting:
-- the trigger writes `new.id` and `new.device_key`, and 0016 grants `anon`
-- insert on `stroke_data` and `device_key` only, so `id` is always a freshly
-- defaulted uuid the caller cannot choose. The unique index on `device_key`
-- stops a key already bound to another mark from being attached to a second,
-- and `on conflict do nothing` is what makes that a no-op rather than an error.
-- So the worst a caller can do is register a device key against a mark that is
-- already theirs.
--
-- Why no test caught it: the suite runs against a bare PostgreSQL as the owner,
-- and an owner passes every privilege check in this file. The distinction only
-- exists once there is an `anon` role, which is to say only on Supabase. It is
-- the third fault of that exact shape — see docs/deploy.md — and the first one
-- that was load-bearing.
--
-- `signatures` is the only table the client writes to directly; everything else
-- goes through a definer RPC, where triggers already run as the owner. That is
-- why this is the only trigger that needed it.

create or replace function public.signatures_register_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.signature_devices (signature_id, device_key)
  values (new.id, new.device_key)
  on conflict do nothing;
  return new;
end
$$;

-- Unchanged from 0021 and repeated because `create or replace` does not reset
-- it: nothing calls this by name, it is only ever reached as a trigger.
revoke execute on function public.signatures_register_device()
  from public, anon, authenticated;

comment on function public.signatures_register_device() is
  'Mirrors a new mark into signature_devices. SECURITY DEFINER because the '
  'client inserts into signatures as anon, which has no rights on '
  'signature_devices — see 0030 for why that is safe.';

-- Proves it against the role that actually failed, inside the migration, so a
-- future schema change that breaks signing again fails here rather than in
-- front of somebody trying to sign.
do $$
declare
  sig uuid;
begin
  -- One stroke, not none: signatures_add in 0001 requires between 1 and 400,
  -- and an empty array fails the policy rather than the privilege check, which
  -- is a different error wearing the same clothes.
  set local role anon;
  insert into public.signatures (stroke_data, device_key)
  values ('{"v":1,"strokes":[{"p":[[0,0],[1,1]]}]}'::jsonb, 'migration-0030-self-check')
  returning id into sig;
  reset role;

  if not exists (
    select 1 from public.signature_devices
     where signature_id = sig and device_key = 'migration-0030-self-check'
  ) then
    raise exception 'signing works but the device row was not written';
  end if;

  -- Leaves nothing behind. delete on signatures is revoked from anon but this
  -- block is running as the migration's own role again by now.
  delete from public.signature_devices where signature_id = sig;
  delete from public.signatures where id = sig;
exception
  when insufficient_privilege then
    reset role;
    raise exception 'anon still cannot sign: %', sqlerrm;
end $$;
