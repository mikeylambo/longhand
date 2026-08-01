-- Close the functions that were never meant to be a client API.
--
-- `revoke execute ... from public` — used in 0002 and 0004 — does nothing here.
-- Supabase carries default privileges that grant EXECUTE on new functions in
-- `public` directly to `anon` and `authenticated`, and revoking from PUBLIC
-- leaves a direct grant untouched. Same shape as the `device_key` column revoke
-- that 0003 had to fix: the broad grant has to be named to be removed.
--
-- Caught by calling /rest/v1/rpc/sweep_expired_turns with the publishable key
-- and getting `0` back instead of a permission error.
--
-- Low severity — the sweep only expires turns already past their deadline, so
-- it could not end a live turn. But it was reachable, and the same idiom was
-- silently doing nothing everywhere else it appeared.
--
-- The security-definer functions keep working: they run as the owner, so their
-- internal calls to pick_seed and inherited_palette are unaffected.

revoke execute on function public.sweep_expired_turns()
  from anon, authenticated;

revoke execute on function public.pick_seed()
  from anon, authenticated;

revoke execute on function public.inherited_palette(jsonb, text, int, int)
  from anon, authenticated;

-- Deliberately still public: v1 has no accounts, so these three are the entire
-- player-facing API.
grant execute on function public.claim_turn(uuid, text, int) to anon, authenticated;
grant execute on function public.release_turn(uuid, text) to anon, authenticated;
grant execute on function public.submit_turn(uuid, jsonb, integer, text) to anon, authenticated;
