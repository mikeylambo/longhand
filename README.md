# Longhand

*A museum the world fills in, one stranger at a time.*

Milestones 1 and 2 of the v1 brief: **the surface** and **the ledger**. Drawing
works and feels good, and every stroke persists as vectors, replays correctly,
and can be isolated per contributor. No queue, no timer, no accounts.

```bash
npm install
npm run dev
```

Deployed for phone testing at **https://longhand-kappa.vercel.app**.

## Two modes

With no Supabase credentials the app runs **entirely in the browser**: the
twelve-slot relay is faked locally and nothing is persisted. That keeps a build
testable for hand-feel work without a database behind it.

Set both env vars and the same UI writes to the real **ledger** instead:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Both are already set on Vercel and in a local `.env.local`, pointing at the
`longhand` Supabase project with `supabase/migrations/*.sql` applied in order.
The review screen states which mode it ran in, so a test is never ambiguous
about whether it saved.

## What is built

**The paint surface** (`src/engine/`)

- Pointer Events with coalesced-event capture, so fast strokes keep every
  sample the OS recorded rather than one per frame.
- Velocity-variable width. Stylus pressure is used when it's real (`pointerType
  === 'pen'` reporting a varying value); everything else is driven by screen
  velocity, measured in css px so the taper feels identical at any zoom.
  Entry and exit tapers on top.
- Position smoothing to kill finger jitter, with the true lift position snapped
  back on release so a line never stops short of your finger.
- One-finger draw, two-finger pan and pinch. A second contact landing on a
  stroke younger than 250ms discards that stroke instead of leaving a stray
  tick. Once a stylus is seen, touch pans but never paints.
- Ink budget as stroke length in logical px. When the pen runs dry mid-stroke
  the line is cut at the exact point the ink ends, not rejected wholesale.
- Additive only. There is no eraser, no destructive compositing, and no code
  path that removes another player's strokes.
- Undo, scoped to the current turn — see *Judgement calls* below.

**Identity** — a drawn signature. No username field anywhere, and no way to
write one.

**Palette inheritance** — every player after slot 1 gets the colours already on
the canvas plus two new ones, offset by the canvas id so two canvases drift
differently. The brief calls this the highest-leverage cohesion mechanic in the
design and it is live: a slot-1 canvas offers all 16 swatches, and a canvas with
three colours on it offers five.

**The ledger** (`supabase/migrations/0001_ledger.sql`) — strokes are vectors,
never pixels. Append-only is enforced by a database trigger, not by application
politeness: a layer row can only ever change its `hidden` flag, and `DELETE`
raises. Slot indices are assigned inside `submit_layer` under a row lock, so two
players can never be handed the same slot. Clients never write to `canvases`,
`layers` or `turns` directly — RLS grants no such policy, and the two RPCs are
`security definer`.

The review screen encodes your layer to the wire format, decodes it again, and
renders *that*, so any loss in the codec shows up immediately instead of two
milestones from now.

**The timelapse**, rendered from the ledger rather than a video file. Scrub the
whole canvas filling in, and tap any contributor to isolate or hide their layer
— which is both the "your layer alone" card and the hide-never-delete moderation
primitive. The milestone 4 server-side MP4 render is the same walk over the same
data.

## Rendering model

Three canvases, because redrawing thousands of quadratics per frame is the
thing that makes a drawing app feel dead:

| Layer | Holds | Rebuilt when |
|---|---|---|
| `baseCv` | paper + every prior layer | view changes, resize |
| `turnCv` | this turn's strokes | view changes, undo |
| display | blit of both + the live stroke tip | every frame |

A stroke segment is final once the *next* sample arrives, so committed
segments are appended to `turnCv` and never touched again — per-frame cost is
proportional to new points, not to the drawing. The last few samples stay
uncommitted (they can still change: exit taper, lift-snap) and are painted on
the display canvas, which clears every frame.

Zoom is a full vector re-render on gesture end, not a bitmap scale, so the
artwork is sharp at every zoom. Mid-pinch the stale cache is blitted with a
relative transform to keep the gesture at 60fps.

Everything is clipped to the sheet rectangle, in the same way the server-side
snapshot will clip it, so the surface never shows a player a mark that won't
survive into the archive. A stroke can't be *started* off-sheet at all — the
margin is dead space you can rest a hand on.

## Tuning

Every hand-feel constant is in `src/config.ts` and overridable from the URL, so
a tuning session on a real phone doesn't need a rebuild:

```
/?tune=1                 slider panel for every constant
/?ink=12000              just the ink budget
/?speedRef=1.2&taper=1.6
```

In dev the live surface is on `window.__lh` for console work.

## What Milestone 1 found

**The 4000px ink budget was far too small.** Measured on a 375px-wide phone
viewport: a single arc across the sheet consumed **3076 of 4000**. The second
stroke exhausted the budget and the pen refused to start a third. That is one
and a half gestures per player — not a contribution, a twitch.

Now set to **14,000**, which leaves real headroom (a three-stroke opening layer
lands around 1,900). Tune it *down* until it bites, against strangers. `?ink=N`.

**A 4:3 landscape sheet wastes about 45% of a portrait phone screen.** At fit,
the sheet is a band across the middle with dead space above and below. It's
inherent to the locked 2048×1536 on a phone, and it's the first thing a new
player sees. Three ways out — a portrait or square sheet, a print-shaped sheet
that opens zoomed-to-width and pans, or accept the letterboxing. Worth deciding
before the gallery and print formats are built on top of it.

**Storage is a non-issue.** A four-stroke layer with 288 points encodes to
6.2 KB. A full canvas at the current budget lands well under 100 KB of jsonb.

## Judgement calls made

**Undo exists**, limited to strokes you made this turn. The non-negotiable is
that you cannot erase *the people before you*, and that is enforced absolutely
— but a stray touch with no undo ruins a turn you only get once, on a device
where stray touches are constant. Delete it if you disagree; it's one method.

**Ink is charged by stroke length only**, as the brief specifies, which makes
the broad pen strictly better value per px. Weighting the cost by pen width is
a one-line change in `StrokeBuilder.add` if playtests show everyone parked on
the broad nib.

## What the ledger was tested against

Not "it compiles" — the invariants were run against the live database:

| Claim | Result |
|---|---|
| Rejoining returns the same open canvas | same id both calls |
| Slots assign sequentially under a row lock | 1, 2, 3 |
| Palette accumulates distinct colours only | duplicate collapsed |
| Rewriting a layer's strokes | blocked by trigger |
| Deleting a layer | blocked by trigger |
| Hiding a layer | allowed |
| Empty layer | refused |
| `anon` reads canvases | yes |
| `anon` sees a hidden layer | no — 2 of 3 rows |
| `anon` inserts / updates / deletes a layer | all blocked |
| `anon` inserts or updates a canvas | blocked |
| `anon` adds a signature | yes; an empty one is refused |
| `anon` reads `signatures.device_key` | permission denied |

Then the same attacks over plain HTTPS with the publishable key, which is what
an attacker actually has:

- `GET signatures?select=device_key` → `permission denied`
- `GET signatures?select=*` → `permission denied` (so **always select explicit
  columns from `signatures`** — `select('*')` will fail, by design)
- `submit_layer` with someone else's `signature_id` → *that signature does not
  belong to this browser*
- `POST /layers` direct → RLS violation
- `PATCH /layers` to hide someone's work → 0 rows
- `DELETE /layers` → 0 rows

And the round trip through the real app: a signature written to `signatures`, a
three-stroke layer stored as slot 1 with 196 points and 3888px of ink at
2048×1536, then a **second browser identity joined the same canvas**, was given
slot 2, loaded slot 1's strokes from the database, and was handed the inherited
five-colour palette.

Two advisory warnings remain and are meant to: `open_or_join_canvas` and
`submit_layer` are `SECURITY DEFINER` and callable by `anon`. v1 has no
accounts, so that is the product. Both carry a `COMMENT ON` saying so.

## Known gaps in the ledger

**One player can still fill every slot on a canvas.** Nothing yet ties a slot to
a distinct person — that is Milestone 3's turn claiming, and it is a real
griefing vector until then.

**The device key is a bearer token in local storage.** Clearing it loses your
identity; copying it takes over your identity. Fine for a slice with no
accounts, not fine for a launch.

**No rate limit.** `submit_layer` caps layer size at 2 MB and 600 strokes, but
nothing stops repeated calls.

## Not built yet

Turn timer, slot claiming and expiry, auto-routing, accounts, notifications, the
gallery, the server-side MP4 render — Milestones 3–5, per the brief.

No service worker yet. The manifest is in place; a caching strategy is worth
nothing until the ledger is real.
