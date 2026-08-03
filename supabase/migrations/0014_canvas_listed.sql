-- Whether a canvas appears in the gallery.
--
-- Distinct from `hidden` on a layer, and deliberately so. Hiding a layer is
-- moderation: the work stays in the ledger, it just stops being served.
-- Unlisting a canvas is curation: the whole thing stays reachable at its own
-- URL — anyone holding the link, and anyone who drew on it, still sees exactly
-- what they saw before — it simply isn't on the shelf.
--
-- The first use is the seeded fixture. It is twelve fixture hands rather than
-- twelve strangers, and the gallery is the archive; a canvas nobody actually
-- drew should not sit in it pretending otherwise. It stays live so the
-- finished-canvas page, the timelapse and the cards can be reviewed.
--
-- Nothing is ever deleted from the ledger. This is another way of not deleting.

alter table public.canvases
  add column if not exists listed boolean not null default true;

comment on column public.canvases.listed is
  'Whether this canvas appears in the gallery. Unlisting is curation, not '
  'moderation: the canvas stays reachable at /c/<id> and nothing is removed.';

create index if not exists canvases_gallery_idx
  on public.canvases (listed, closed_at desc)
  where status = 'closed';
