# Longhand

*A museum the world fills in, one stranger at a time.*

Milestone 1 of the v1 brief: **the surface**. Drawing works and feels good, and
every stroke is captured as vectors in the exact shape the ledger will store.
No backend, no queue, no timer, no accounts.

```bash
npm install
npm run dev
```

Dev server binds to `0.0.0.0:5180` on purpose. Milestone 1 is a hand-feel test
and cannot be judged on a trackpad — open it on a phone on the same wifi.

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

**Identity** — a drawn signature, stored locally, no username field anywhere.

**The ledger** — strokes are vectors, never pixels. The review screen encodes
your layer to the wire format, decodes it again, and renders *that*, so any
loss in the codec shows up immediately instead of two milestones from now.

**The relay, faked locally** — finishing a turn pushes your layer onto the prior
stack and hands you the next slot, up to 12. Wrong social model on purpose; it
exercises the exact rendering path a real twelve-stranger canvas will take.

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

**The 4000px ink budget is far too small.** Measured on a 375px-wide phone
viewport: a single arc across the sheet consumed **3076 of 4000**. The second
stroke exhausted the budget and the pen refused to start a third. That is one
and a half gestures per player — not a contribution, a twitch. Twelve of those
will not make a picture.

Recommendation: start around **12,000–16,000** and tune *down* until it bites.
The number is easy to change; the playtest is not. `?ink=N` to try one.

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

## Not built yet

Palette inheritance is a v1 requirement but needs prior-layer colour data from
the server, so it lands with Milestone 3. Turn timer, slot claiming, accounts,
notifications, gallery, timelapse — Milestones 3–5, per the brief.

No service worker yet. The manifest is in place; caching strategy is worth
nothing until there's a backend to be offline from.
