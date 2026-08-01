-- Supersedes the column revoke in 0002, which was a no-op.
--
-- `revoke select (device_key)` does nothing when SELECT has been granted on the
-- whole table, which is Supabase's default for `anon`. Column privileges only
-- bite once the table-wide grant is gone, so the grant has to be replaced with
-- an explicit column list.
--
-- This matters because 0002 binds authorship to the device key. If clients can
-- read the column, the check it guards is theatre.

revoke select on public.signatures from anon, authenticated;

grant select (id, stroke_data, created_at)
  on public.signatures to anon, authenticated;

-- Inserting still needs the column; only reading it is closed off.
grant insert (stroke_data, device_key)
  on public.signatures to anon, authenticated;
