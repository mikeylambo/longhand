-- Finishes what 0006 started.
--
-- Closing a function on Supabase takes TWO revokes, and either one alone is a
-- no-op that looks like a fix:
--
--   revoke execute ... from public              -- Postgres grants EXECUTE to
--                                                 PUBLIC on every new function
--   revoke execute ... from anon, authenticated -- Supabase default privileges
--                                                 grant it to these directly
--
-- 0006 did only the second, so `sweep_expired_turns` closed (0004 had already
-- revoked it from PUBLIC) while `pick_seed` and `inherited_palette` stayed
-- reachable through PUBLIC. Verified by calling both over REST afterwards and
-- getting results back rather than 42501.

revoke execute on function public.pick_seed() from public;
revoke execute on function public.inherited_palette(jsonb, text, int, int) from public;
revoke execute on function public.sweep_expired_turns() from public;
revoke execute on function public.layers_append_only() from public, anon, authenticated;

-- Re-granted after the PUBLIC revoke, because these three are the whole
-- player-facing API and v1 has no accounts.
grant execute on function public.claim_turn(uuid, text, int) to anon, authenticated;
grant execute on function public.release_turn(uuid, text) to anon, authenticated;
grant execute on function public.submit_turn(uuid, jsonb, integer, text) to anon, authenticated;
