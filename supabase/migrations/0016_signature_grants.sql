-- Finish what 0003 started on signatures.
--
-- 0003 narrowed which *columns* could be read, so device_key stays secret and
-- authorship cannot be spoofed. It never touched the table-level write grants,
-- so `anon` still held INSERT, UPDATE and DELETE on the whole table. RLS blocks
-- update and delete — there is no policy for either — but a mark is somebody's
-- entire identity here, and it should not be one stray policy away from being
-- editable by anyone.
--
-- Insert stays, restricted to the two columns 0003 named: a player has to be
-- able to sign. id and created_at keep their defaults rather than being
-- accepted from the client.

revoke insert, update, delete on public.signatures from anon, authenticated;

grant insert (stroke_data, device_key)
  on public.signatures to anon, authenticated;
