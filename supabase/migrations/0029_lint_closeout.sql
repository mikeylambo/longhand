-- Two findings from the first security review of the deployed schema.
--
-- Neither is exploitable and both are one line, which is exactly when they
-- should be fixed: a standing lint is a thing every future review has to
-- re-investigate before concluding it is fine, and that cost is paid over and
-- over while the fix is paid once.
--
-- 1. `mark_floor()` was the only function in this schema without a pinned
--    search_path. Nothing could reach it — it is revoked from every client role
--    and its one caller, `layer_ink`, names it as `public.mark_floor()` from a
--    body that is itself pinned — so this is tidiness rather than a hole. But
--    "every function here pins its search_path" is a rule worth being able to
--    state without an exception attached.
--
-- 2. pg_net was recorded against `public`. Its functions and tables are all in
--    its own `net` schema and always were, so there was never anything of
--    pg_net's in `public` to reach; what sat in `public` was the catalogue row.
--    Already corrected on the live project, and 0028 now names `extensions` so
--    a fresh build never records it there in the first place. Nothing to do
--    here: pg_net is not relocatable, so moving it means dropping and
--    recreating it, and a migration that dropped an extension on every re-run
--    would be far worse than the finding.
--
-- The forty remaining warnings are all one finding wearing forty hats: every
-- player-facing RPC is SECURITY DEFINER and executable by `anon`. That is the
-- design and not an oversight — v1 has no accounts, so `anon` is every player,
-- and each of those functions checks `owns_signature` before it does anything.
-- The alternative is accounts, which is a different product.

create or replace function public.mark_floor()
returns numeric language sql immutable
set search_path = public
as $$ select 18::numeric $$;

revoke execute on function public.mark_floor() from public, anon, authenticated;

comment on function public.mark_floor() is
  'The ink a single mark costs at minimum, matching MARK_FLOOR in '
  'src/engine/tools.ts. Both exist so neither side has to trust the other.';
