-- A canvas remembers its own shape.
--
-- Layers already record the dimensions they were drawn against, but every
-- renderer read the current CANVAS_W/CANVAS_H constants instead. So changing the
-- sheet from 2048×1536 to 2048×2048 silently reflowed every canvas already in
-- the archive: the same strokes, composed against a different rectangle.
--
-- That is the archive-corruption shape — invisible in the moment, permanent
-- afterwards, and it would recur on every future format change. A canvas is
-- meant to be unchangeable once closed, so its shape has to be a fact stored
-- with it rather than whatever the client happens to be compiled with.
--
-- Existing rows keep 2048×1536, which is what they were actually drawn on.

alter table public.canvases
  add column if not exists width  integer not null default 2048,
  add column if not exists height integer not null default 2048;

update public.canvases
   set width = 2048, height = 1536
 where created_at < now()
   and exists (
     select 1 from public.layers l
      where l.canvas_id = canvases.id
        and (l.strokes -> 'h')::int = 1536
   );

comment on column public.canvases.width is
  'Sheet size this canvas was opened at. Never changes; the renderer must use '
  'this rather than a client constant, or old canvases reflow when the default '
  'changes.';
