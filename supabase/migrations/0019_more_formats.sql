-- The classroom and the marathon.
--
-- Same engine, wildly different output, and it ships as data rather than code —
-- which was the whole argument for `canvas_formats` being a table.
--
-- Both open at weight 0, meaning the rotation never opens one on its own. A
-- twenty-four is the original paper game and it is chaos; a hundred is a mural
-- that takes a month to close. Neither is something a stranger should be
-- dropped into by an assignment rule they cannot see. They exist to be asked
-- for, by a teacher with a class or by somebody who wants to start something
-- long.

insert into public.canvas_formats (slot_count, label, weight) values
  (24,  'classroom', 0),
  (100, 'marathon',  0)
on conflict (slot_count) do update
  set label = excluded.label, weight = excluded.weight;

comment on column public.canvas_formats.weight is
  'Share of new canvases opened at this size when nobody asked. 0 means the '
  'rotation never opens one — the format exists, but only on request.';
