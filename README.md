# Longhand

*A museum the world fills in, one stranger at a time.*

Milestones 1–4 of the v1 brief: **the surface**, **the ledger**, **the loop**
and **the close**. Twelve distinct hands claim slots on a shared sheet, each on
a ten-minute clock, and when the twelfth submits the canvas locks forever and
gets its own page. No accounts.

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
primitive.

**The loop.** A slot is *claimed* before it is drawn on, so nothing is
double-booked and nothing is reserved forever:

- `claim_turn` reserves a slot and starts a ten-minute clock. Reloading resumes
  the same turn rather than burning a second slot.
- A partial unique index on `(canvas_id, slot_index) where state = 'active'`
  makes a double-booked slot impossible to *store*. The advisory lock and the
  row lock are reasoning; the index is a fact.
- `layers (canvas_id, signature_id)` is unique, so **one hand per canvas**. That
  is the whole premise, and until this milestone one person could fill a canvas
  alone.
- Abandoned slots return to the pool. `sweep_expired_turns` runs every minute on
  pg_cron *and* opportunistically at the top of every claim, so the relay keeps
  healing even with no scheduler running — which matters most precisely when
  nobody is arriving.
- The clock is visible from the first second, because per the brief an expired
  slot returns to the pool and the drawing is lost.

**The close.** Slot 12 submits, the canvas flips to `closed`, and it gets a
shareable page at `/c/<id>` with the full piece, the scrubbable timelapse, every
contributor's layer alone, and PNG downloads. `/gallery` lists finished work,
newest first — no counts, no ranking, no leaderboard, ever.

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

Now **10,000**, tuned against measurements rather than a guess: a stick figure
at phone scale costs ~4,300, and one dense scribbled stroke from a live layer
cost 10,909. So a considered contribution fits comfortably and a careless one
costs the whole turn. `?ink=N` to try another.

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

## What the loop was tested against

The concurrency bug is the one that fails silently, so it was tested before the
feature was wired to any UI: **20 simultaneous `claim_turn` calls over HTTPS**,
fired in parallel with no stagger.

- 20 claims returned, 0 errors
- **zero double-booked slots**
- the first canvas took exactly slots 1–12; the overflow opened a second canvas
  and took 1–8

Then the rest of the state machine: a hand-written duplicate active turn is
refused by the index; reloading resumes the same turn; a player holds at most
one turn anywhere; the sweep expires an abandoned turn and another player
immediately reclaims that slot; twelve submits flip the canvas to `closed` with
`closed_at` set and **twelve distinct signatures**; a closed canvas takes no
more claims.

Over REST with the publishable key: submitting against an expired turn, against
someone else's turn, and claiming with a device key that isn't yours are all
refused. And in the browser, the clock reaching zero locks the pen, disables
Finish and offers another slot.

## The sheet is square

2048×2048, not the brief's 2048×1536. A 4:3 landscape sheet fitted into a
portrait phone is a band across the middle with dead space above and below — the
first thing a new player sees is a strip rather than a surface. Square fills the
width edge to edge and takes 56% of the stage height on a 375×812 phone, against
about 42% before.

**A canvas stores its own width and height** (`canvases.width/height`). Every
renderer reads those rather than the current constant, because otherwise
changing the default silently reflows everything already in the archive — the
same strokes composed against a different rectangle. That is the
invisible-now-permanent-later failure this project cannot afford, and it was
live for about ten minutes before migration 0008. Canvases opened at 2048×1536
still render 4:3, verified.

## Ink, measured

The meter is wired to real consumption. Per-stroke cost is logged to the console
in dev:

| drawing | strokes | ink | of budget |
|---|---|---|---|
| stick figure, phone scale | 8 | 4,335 | 43% |
| one dense scribbled stroke | 1 | 10,909 | over |

(Percentages against the 10,000 budget now in force.) A considered contribution
runs about 4,000–5,000, so the budget allows roughly two of them — and the
scribble that cost 10,909 would now run dry mid-stroke, which is the point.

The meter itself was 3px tall, which made a third of the budget draining look
like nothing happening. Now 6px.

## Known gaps

**The device key is a bearer token in local storage.** Clearing it loses your
identity; copying it takes over your identity. Fine for a slice with no
accounts, not fine for a launch.

**No rate limit.** `submit_turn` caps a layer at 2 MB and 600 strokes and a turn
must be claimed first, but nothing throttles repeated claims across many
signatures.

**Losing an unsubmitted drawing at 10:00 is harsh.** It is what the brief
specifies, and the clock is visible throughout — but auto-submitting non-empty
work would keep the canvas moving *and* not destroy anything. Worth a decision
after real strangers hit it.

**Testing a close alone is now impossible on the ledger.** One hand per canvas
is enforced in the database, so watching a canvas fill takes twelve real
browsers — which is the brief's success criterion, not an obstacle to route
around. Run without Supabase credentials for a solo relay when you only want to
exercise the surface.

## The timelapse export

`Save the timelapse` on a canvas page records an MP4 — H.264 where the browser
can mux it, WebM as the fallback, and the filename matches whatever was actually
produced rather than lying about it.

It is the same `buildTimeline`/`paintRange` walk the in-app scrubber uses, which
`selftest` proves lands on pixels identical to the archived snapshot however
many steps it takes. So the video, the scrubber and the print cannot disagree.

Fixed at ~20s regardless of layer count — position along the walk is normalised
— because an artifact that runs 8 seconds for one canvas and 40 for another is
not a format. The last 3.5s rest on the finished piece while a caption fades in
over the paper margin: the seed word and the number of hands, so the file
carries its own context when it turns up somewhere with no page around it.

Recording is real-time and driven by `requestAnimationFrame`, which browsers
freeze in a background tab. Unguarded that yields a file that is mostly one held
frame with no error anywhere, so the export refuses to start on a hidden tab and
aborts if the tab goes away mid-record.

Measured on the seeded canvas: `video/mp4;codecs=avc1.42E01E`, 379 KB, 20.02s,
12 layers, 2048×2048.

`tests/video.spec.ts` asserts a real file comes out. It lives in Playwright and
not in the app preview for a concrete reason — Playwright's page is genuinely
visible, so it is the only place the recording path can be exercised at all.

## Seeding a canvas to look at

`node scripts/seed-canvas.mjs` fills one canvas with twelve fixture layers from
twelve distinct signatures, each claiming a turn and submitting against it
through the real endpoints. What lands in the ledger is shaped exactly like
player data; the only thing faked is the hands. Every layer comes in under the
10,000 budget, which is also a useful check that the budget is survivable.

## Not built yet

A *server-side* render. The export above runs in the player's browser, which is
fine for someone saving their own canvas but no use for generating an OG preview
image or a video for a canvas nobody has opened. That needs a worker.

Notifications (Milestone 5). Accounts, the world map, prints, school accounts —
all explicitly out of scope for v1.

No service worker yet. The manifest is in place; a caching strategy is worth
nothing until there is something to be offline from.
