-- Say the grants out loud.
--
-- Every table read in this schema was readable only because of an implicit
-- grant the hosted platform applies to new tables in `public` — nothing in any
-- migration ever said so. Building the same migrations from scratch against a
-- local stack produced a database where `anon` could not read a single row, and
-- the app would have come up dead. The repo has to be the whole truth about the
-- schema, so here it is.
--
-- The second half is defence in depth. On the hosted project `anon` also held
-- INSERT, UPDATE and DELETE on canvases, layers and turns. Nothing could use
-- them — RLS defines no write policy, and that was verified by attacking the
-- endpoint — but the grants sat there waiting for the day somebody adds a
-- permissive policy for an unrelated reason. Writes go through the
-- security-definer functions, so the grants can go.
--
-- Read paths, stated deliberately:
--   canvases        select — the gallery and every canvas page
--   layers          select — RLS still hides hidden rows
--   turns           select — matches the existing read policy
--   palette_colors  select — the colour list, read by tooling and tests
--   signatures      untouched: 0003 restricts it to id/stroke_data/created_at,
--                   because device_key is what proves authorship
--   seeds           nothing — only pick_seed() inside a definer function

grant select on public.canvases       to anon, authenticated;
grant select on public.layers         to anon, authenticated;
grant select on public.turns          to anon, authenticated;
grant select on public.palette_colors to anon, authenticated;

revoke insert, update, delete on public.canvases from anon, authenticated;
revoke insert, update, delete on public.layers   from anon, authenticated;
revoke insert, update, delete on public.turns    from anon, authenticated;
revoke insert, update, delete on public.seeds    from anon, authenticated;
revoke select                  on public.seeds    from anon, authenticated;
revoke insert, update, delete on public.palette_colors from anon, authenticated;

-- Future tables in this schema inherit nothing by accident either.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;
