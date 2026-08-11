# Foolscap

*A museum the world fills in, one stranger at a time.*

Milestones 1–4 of the v1 brief — **the surface**, **the ledger**, **the loop**
and **the close** — plus **Phase A** (everything that has to exist before a
stranger sees it), **Phase B** (feature-complete) and **Phase C** (the museum).

Distinct hands claim slots on a shared sheet, each on a ten-minute clock, and
when the last one submits the canvas locks forever and gets its own page. Two
hands, four, twelve, a classroom of twenty-four or a marathon of a hundred. No
accounts.

```bash
npm install
npm run dev
```

Live at **https://www.foolscap.ink**. The apex 308-redirects to `www`, so
there is one origin rather than two — which matters more than which one won,
because identity, push subscriptions and the service worker are all scoped to
the origin and a split would quietly halve every returning visitor.

`longhand-kappa.vercel.app` still answers and is a third origin. Anyone who
drew there before the domain existed is a stranger on `www.foolscap.ink`, and
that is the expected, one-time cost of moving; it was paid at zero push
subscriptions. Share only the canonical host from here.

Storage keys are still `longhand.*` on purpose — see *Known gaps*.

The repository, the Supabase project and the Vercel project all still read
`longhand`. None of them is user-visible and renaming any of them costs more
than it returns: the repo would break every existing clone and link, and the
Supabase project ref is baked into the deployed client's env.

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

**Every player gets all sixteen colours.** Palette inheritance is built and
kept, but switched off — `PALETTE_MIN` in `src/config.ts` and `p_floor` on
`inherited_palette()` are the switch, and the two must agree because the server
rejects colours a turn was not offered. 16 = off, 6 = on with a floor, 0 = the
brief's literal rule.

It came off for two reasons. It never worked under a burst of arrivals: the
palette is fixed at claim time, correctly, but inherits from what has been
*submitted*, so twelve people arriving on a shared link were each offered
everything regardless. And the constraint that actually produces cohesion is
that all sixteen are hand-picked muted tones which cannot clash badly —
rationing which of them each player may touch was a second-order rule that cost
the last players their range for very little.

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
- **A slot costs more than a tap.** `minInk` is a floor on the layer, enforced
  in the client and again in `submit_turn`, because a slot is not recoverable
  and playtesting found a single dot could spend one. Measured in ink rather
  than strokes: a stroke count cannot tell a dot from a line. A tap measures
  18, a drawn centimetre 200, and the floor is 200 — enough to stop an
  accident, not enough to demand a drawing.
- **A slot can be handed back.** There was no way out of a claimed turn short
  of waiting out the ten minutes, which makes everyone else on the canvas wait
  too. One tap when nothing is drawn, two when there is work to lose.

**The close.** The last slot submits, the canvas flips to `closed`, and it gets
a shareable page at `/c/<id>` with the full piece, the scrubbable timelapse,
every contributor's layer alone, and PNG downloads. `/gallery` lists finished
work, newest first — no counts, no ranking, no leaderboard, ever. It pages
with a keyset cursor rather than an offset, and filters to the canvases your
mark is on: still the same list in the same order, because "yours" is a
navigation problem and not a reason to start scoring anything.

**The first visit** — one screen, once, led by a six-second clip of a finished
canvas assembling itself. See *The first thing a stranger sees* below.

**Duos and quartets**, alongside twelves. See *Formats* below.

**A moderation floor** — a report control that is one tap and no text field, a
queue you read with one command, and the two levers: hide a layer, unlist a
canvas. See *Moderation* below.

**Terms and a position on young people**, at `/terms` and `/safety`, written
before the first stranger drew rather than after.

## What Phase B and Phase C added

The roadmap gates Phase B on the twelve-stranger test and Phase C on
retention, so that each tool answers an observed failure rather than a guessed
one. Both gates were skipped deliberately, by decision, and the consequence is
worth writing down: **every branch of B2 is built rather than the one the gate
would have chosen.** Nothing here has met a stranger.

| | |
|---|---|
| B1 | A mark that survives a cleared browser, and notifications when a canvas moves or closes |
| B2 | Stamps, bounded fill, translucent wash, texture pens |
| B3 | A page per hand — every canvas it has been on, and what you have shared with it |
| B4 | Gifted slots: one held place, for one person |
| B5 | Seeds that change without a deploy, and guest artists opening a canvas |
| B6 | Classroom (24) and marathon (100) formats |
| C1 | The world map: finished canvases pinned where they closed |
| C2 | `/screen` — the gallery as a wall |
| C3 | Prints, gated on every contributor's consent. **No payment processor is wired.** |
| C4 | Cosmetic ink sets, enforced cosmetic in the schema. **No payment processor is wired.** |
| C5 | Classrooms: private canvases, a code read off a whiteboard, no accounts for children |
| C6 | `/ar/<id>` — viewing a finished canvas in the room. Viewing only, forever |

## Formats

Two hands, four, or twelve. `slot_count` has been a column rather than a
constant since migration 0001, so the engine, the close condition, the gallery
and the video already handled any number; 0017 is the part that was missing.

The reason is arithmetic, not variety. With a small population a twelve may
never close, and a stranger who draws into a canvas that never closes has seen
one twelfth of the product — no finished piece, no timelapse, no video, no hand
of their own on bare paper. **A duo closes with one other person.** That turns a
partial experience into a whole one, and it is the cheapest fix for cold start
in the whole roadmap.

**Assignment is biased toward the canvas closest to closing**, not the oldest.
A twelve with eleven hands on it beats a fresh duo, because the point is that a
stranger's hand is the one that finishes something as often as possible. It is
a preference rather than a promise: remaining slots are counted from what has
been submitted, so a canvas whose last free slot is held by a live turn sorts as
though it were free — it just cannot be *chosen* while that turn lives.

A player can also ask, from the review screen: *or ask for a duo · a quartet ·
twelve hands*. Asking is deliberately the quiet option — taking whatever is
closest to closing is the right answer for almost everybody.

**New canvases open on a rotation** — duo, duo, quartet, twelve — derived from
how many canvases exist, so it is deterministic and there is no counter to
drift. The weights live in `canvas_formats` and can change without a deploy,
which is also why `canvases.slot_count` is a foreign key into that table rather
than a check constraint: a canvas cannot be opened at a size that is not a
format, and the list of formats is data.

`tests/formats.spec.ts` asserts every row in `canvas_formats` has a name in the
client, so a format added to the table can never reach a player as a bare
number.

## The mark

A lowercase **f** in the negative space where three painted forms overlap —
teal, brick red and ochre, with their overlaps darkening as ink does. It is the
product's own logic rather than an illustration of its name: several hands,
additive, nothing removing what is under it, in the palette the canvases are
already drawn in.

`brand/foolscap-mark.svg` is the source and the only place the mark is drawn.
Every raster is derived from it by `node scripts/icons.mjs`, so none of the
files in `public/` should ever be edited by hand — if an icon is wrong, the fix
is in the SVG or the script. Chromium does the rasterising, because it is
already installed for the tests and it renders SVG the way the browsers showing
these icons will, which avoids the classic icon bug where a build-time
rasteriser disagrees with the platform about a path and nobody notices until it
is on somebody's home screen.

Two sizes are decisions rather than defaults:

- **Maskable is 58% where the others are 80%.** The platform may crop a
  maskable icon to a circle of 80% diameter, so the mark has to fit inside that
  *circle*, not the square. The mark is 602×769, so its diagonal is 1.27× its
  height, which allows 63% — 58% leaves room for the shapes' irregular edges.
- **The favicon is an SVG first.** The `f` is negative space, and at 16px a
  raster closes its counters into a smudge while the vector stays open.
  Verified by rendering both: the 16px PNG loses the letter, the 16px SVG keeps
  it. The PNGs remain as fallback for anything that will not take an SVG.

The apple-touch icon is opaque on purpose: iOS composites a transparent one
onto black, which would put the mark in a dark box.

The tab bar keeps its line-drawn glyphs, including the nib for Draw. A
full-colour mark in one of four slots would be the only coloured thing in the
row and would read as an advert for itself rather than a label for a
destination. The mark identifies the app — icon, splash, favicon — and never
labels a section.

## Moving around

Four destinations in a bar at the bottom — Draw, Gallery, World, You — with
the current one lit. Terms and safety sit under it, small and grey, because
they are promises rather than places and a parent who has never drawn anything
still has to be able to find the second one.

This replaced a single row of small grey links, which is how a website ends a
page, and it read like one.

**Navigation no longer reloads the document.** It used to, deliberately, on the
grounds that every route here is somewhere you arrive at from outside — a
shared link, a notification. That is true of *arriving* and wrong about moving
around, and it only became wrong once the product was meant to hold somebody
for an hour: every tap threw away the bundle, remounted React and re-booted the
session. It also replayed the launch splash on every screen change, which on
the fourth tap in a minute reads as broken rather than as opening.

`src/ui/Router.tsx` is about eighty lines and no dependency. The URLs are
unchanged and still real, the markup is still plain anchors, and arriving from
outside still loads that route directly — a shared `/c/<id>` behaves exactly as
it did, and so does a browser with no JavaScript. All it adds is: when the app
is already running, do not throw it away to move one screen. Section changes
use the same view-transition crossfade the phases of a turn use.

Links to another origin, new tabs, downloads and modified clicks are left to
the browser, and there is a test that asserts the router does not swallow them.

## Opening

The splash is inline in `index.html`, above the module script, so it paints on
the first parse rather than after a 300 KB bundle has been fetched and
mounted. An installed app that opens on white for half a second reads as
broken in a way the same half-second behind a wordmark does not, and iOS gives
a standalone PWA no splash of its own unless it is handed a startup image per
device size.

Coming *down* is the harder half. It used to be a timer alone — a floor of 1.4
seconds from the moment the bundle ran — and on this machine that is always
fine: traced frame by frame, a first visit paints the welcome screen at 305 ms
and the splash begins fading at 1660 ms, and it still holds under a twelvefold
CPU throttle, because everything that slows the mount slows the timer with it.

The case a timer cannot survive is the one that matters most in an installed
app. The shell comes off the service worker instantly and the hand is already
signed, so booting is one round trip to the relay to be given a slot. When that
round trip outlasts the floor the splash lifts and uncovers `Finding you a
sheet…` — a second loading screen behind the first one, two waits where there
should be one.

So `src/ui/boot.ts` lets a screen say it is not ready, and the handover waits:

| | |
|---|---|
| **Floor** 1.4 s | A wordmark that flashes past reads as a glitch rather than as opening |
| **Ready** | `App` while it is still claiming a slot; `CanvasPage` while a shared link is still loading |
| **Ceiling** 4.2 s | A relay that never answers must not trap anybody behind a logo — past that, the loading screen is the honest thing to be looking at |

Holds are keyed rather than counted, so a screen answers one question on every
render — am I ready — instead of pairing up acquisitions and releases.

The slow connection this is for does not exist on a development machine, which
is exactly why it is tested rather than trusted: `tests/boot.spec.ts` imports
`boot.ts` into the page at the same URL the app imports it from, which makes it
the same module instance, and holds the splash open from before the app boots.
Reverting the handover to the old timer fails two of the four.

## The first turn, taught

Not a tour. A stepped overlay on launch is the thing people dismiss without
reading, and it would contradict the bet this product already made — one
welcome screen, then straight onto a sheet. Somebody who has not drawn
anything has no questions, so answering four of them up front is noise.

So each lesson waits for the moment it is *about*, and is drawn next to the
thing it is about. `src/ui/coach.ts`:

| When | What | Points at |
|---|---|---|
| Arriving on the sheet | Two fingers to move and zoom — the only control not on screen | the zoom readout |
| The first stroke lands | Nothing here can be rubbed out — yours or anyone else's | nothing — the sheet |
| The ink meter has visibly moved | The pen runs out; this is all the ink this turn gets | the meter |
| Three strokes in, tray never opened | There is more than a pen in the tray | the tray |

The permanence rule is the one that most justifies the approach: said on
arrival it is a warning about nothing, and said the instant a stroke lands it
is a fact about something they just did.

A hint that said "there is more than a pen in the tray" from the middle of the
screen was asking the reader to go and find the tray, so each pill now sits
beside the control it names with a caret aimed at it — the tray, the ink
meter, the zoom readout that the two-finger gesture changes. The exception is
permanence, which points at nothing on purpose: it is a statement about the
whole surface, and the whole lesson is that there is no eraser to point at.
The anchor is CSS relative to the stage rather than a measured canvas
coordinate, so it cannot drift when somebody pans mid-hint — the tools button
is the middle of the tray's seven, so the tray's own centre, and the meter and
readout do not move. `tests/coach.spec.ts` asserts the id-to-anchor mapping
and that the class lands on the sheet.

One at a time, longest-waiting first, and the hint slot has an order rather
than three things that can stack in it — a fill's refusal answers a tap that
just happened and wins; the ink floor explains a disabled button in front of
them; a lesson is the least urgent thing on screen and waits.

Coaching ends when a turn is **submitted**, not when a slot is handed back:
somebody who completed a turn learned these by doing them, and somebody who
backed out of their first one has not. Nothing blocks, nothing needs
dismissing, and every lesson is about something the interface already shows —
so a player who ignores all of it loses nothing.

## The first thing a stranger sees

One screen, once, and the clip does the teaching. A finished canvas assembling
itself explains hands-arrive-one-at-a-time-and-nothing-goes-away without a word
of instruction; every attempt to say it in prose was longer and worse.

It is the same `buildTimeline`/`paintRange` walk as the scrubber and the MP4
export, not a video file — so there is no muxing, no autoplay policy to
negotiate, no audio track to promise is muted, and it is sharp on any screen.
Six seconds to fill, a moment to look at it, then again.

It ships as a **baked fixture** rather than the newest closed canvas.
`scripts/make-welcome.mjs` renders the twelve fixture hands from
`scripts/scene.mjs` into `public/welcome-canvas.json` (66 KB, 26 KB over the
wire), which is the same scene `seed-canvas.mjs` pushes through the real
endpoints. Reading the archive instead is wrong twice over: it is empty on
launch day, which is the only day this screen really matters, and it would put
whatever a stranger drew last night in front of the next stranger with nothing
between the two but hope.

Everything else on the screen answers a question somebody has before they will
draw. The ink rule is stated as a promise *before* they draw rather than as a
warning after they try. The count — "4 of 12 hands are already on the sheet you
would join" — answers whether anyone else is here. The clock is explained once,
gently, so ten minutes reads as room to think. The signature gets its reason on
the screen that asks for it.

The words have one reader who is two people at once: a child who has picked up
a parent's phone, and someone who arrived on purpose. Both have to feel
welcome, which rules out two temptations — prose that reads like museum wall
text, and prose that talks down. So the register is concrete, spare, and a
little celebratory: *One canvas, many hands*, not *one sheet, passed between
strangers*; *Permanent ink — embrace the happy accidents*, not *ink only*; a
turn you *pass right to the next artist*, not a slot that *goes back to the
pool*. The clip carries the concept — a drawing building itself has no reading
age — and the words only have to stay out of its way. The signature screen
leads with the doing, *draw a symbol to stand for you — a doodle, any shape*,
because a child will scribble happily and read nothing, and the box says
**draw here** so that a blank rectangle is legibly theirs to touch; that the
mark is *a stamp that follows you onto every canvas* comes second, for whoever
wants it.

No tutorial, no carousel, no dismissible tips over the sheet. If it takes more
than one screen the product is the problem, and a longer explanation only hides
that.

`tests/onboarding.spec.ts` guards it, because the screen is behind a
localStorage flag: once it has been seen it is invisible to whoever is
developing, and you can break it thoroughly without noticing.

## Moderation

The tools exist before they are needed, which is the only time it is possible
to build them calmly.

**Reporting is one tap.** No form, no category, no text field — the drawing is
the only channel this product has, and a reason box would be a message box
wearing another name. There is a control on every canvas page, one on each hand,
and one on the sheet during a turn (which appears only once somebody else's work
is on it — an empty canvas has nothing to report, and offering it anyway reads
as an invitation).

A second tap from the same browser is collapsed rather than counted, so nobody
can manufacture weight by tapping, and a device past thirty reports an hour is
dropped. Neither is reported back: telling one browser it has been rate-limited
only tells it how to spread its taps around.

**The queue is one command.**

```bash
DATABASE_URL='postgresql://...' scripts/moderate.sh queue
```

Same connection string the nightly backup uses, and it is never printed. Then
`hide <layer-id>`, `unlist <canvas-id>`, `dismiss <canvas-id>`, `show
<canvas-id>` and `log`. Every action goes through a `service_role`-only function
rather than a direct write, so it is recorded in `moderation_actions` and the
reports it answers are resolved in the same breath.

**Nothing here deletes anything, and no command could.** Hiding sets the one
column the append-only trigger permits; the row stays in the ledger and stops
being served. Unlisting takes a canvas off the shelf and leaves its URL working
for everyone who drew on it.

`open_or_join_canvas` also lost its grant here. It has been dead since 0004 —
`claim_turn` does all of it, under a lock — but it was still executable by
`anon`, which meant anyone with the publishable key could open empty canvases in
a loop. The moderation surface is meant to be small, and an unused write path
reachable by strangers is surface for nothing in return.

## Terms and young people

`/terms` and `/safety`, and they are part of the app rather than a file under
`docs/` so there is exactly one copy. Terms applied retroactively to work people
have already made cannot be cleaned up afterwards — you cannot go back and ask
twelve strangers whether the licence they never read may change — so the words
somebody agreed to have to be the words that shipped that day, and the history
of `src/content/legal.ts` is that record.

The position, in short:

- **Each contributor owns their own layer.** No assignment of copyright, ever.
  A finished canvas is a collective work and nobody owns the whole of it alone,
  including us.
- **What you grant is a non-exclusive, perpetual licence** to store, display,
  render and print *the canvas your layer is part of*. Perpetual because the
  archive is append-only — a licence that could be withdrawn would be a promise
  this product is not built to keep — and non-exclusive so you keep every other
  right you have, including selling prints of your own layer yourself.
- **Never** sold on its own, never licensed on its own, and never used to train
  a model.
- **If prints are ever sold**, every contributor is told first and can decline
  to be in the printed edition. That does not remove them from the canvas.
- **Thirteen and up**, stated, with no age form. A date-of-birth box collects a
  piece of personal information about a child in order to turn them away and
  stops nobody. The honest position is a stated minimum age, a product that
  collects nothing about anyone, and moderation that works.

The safeguarding is the design: no chat, no comments, no DMs, no text tool, no
avatars, nothing that says where anybody is, and nobody able to remove or deface
what a child draws. Each of those absences is load-bearing and each is listed
under *Never* in the roadmap for exactly this reason.

**This has not been through a lawyer.** It should be before anything is sold,
which is the moment the print line in Phase C arrives.

## The tools

Five of them, and the constraint they were chosen against is the reason they
were cheap: **every one produces ordinary `Stroke` rows in the format the
ledger has stored since milestone 2.** A tool that needed a new kind of row
would need a new renderer, a new codec path, a new video path and a new print
path, and would divide the archive into things that replay and things that used
to.

**Stamps** — birds, leaves, a window, a boat. The biggest inclusivity lever in
the product: somebody who says they cannot draw still puts down something that
reads as intentional. Priced at their own outline length, so a stamp is never
cheaper than drawing the same thing by hand, and rotated slightly by where they
land so a row of them reads as placed rather than tiled.

**Texture pens** — hatch, stipple, halftone. Depth without skill. Marks are
spaced by distance travelled rather than by pointer events, so a slow drag and
a fast one lay down the same density; otherwise the tool rewards moving your
finger slowly, which is not a skill.

**Translucent wash** — multiplies over what is beneath at a fixed low alpha.
This is the one that needed guarding. A multiply never removes a pixel, which
is what makes it additive, and a dark enough one repeated over somebody's work
leaves a rectangle where their drawing was — which is removal by another name.
So a wash is restricted to the lighter half of the range, checked in
`wash_colour_allowed()` server-side and greyed out in the palette client-side,
and the UI switches you off ink the moment you pick it up.

**Bounded fill** — colour inside what a previous player outlined. The purest
response act available: it cannot be done alone, it cannot be done first, and
what it produces depends entirely on what the people before you left.

The fill is stored as **a polygon, not a seed point.** Flooding the region and
keeping the tap position would be a tenth of the bytes and completely wrong:
two browsers antialias a curve differently by one pixel, the flood escapes
through that pixel on one of them, and the archive stops being the same picture
everywhere it is opened. So the region is flooded once, on the phone that
tapped, its boundary traced with Moore-neighbour tracing, simplified with
Douglas–Peucker, and stored as geometry. A polygon is a fact.

It refuses to escape. A tap that reaches the edge of the sheet, or covers more
than a third of it, is refused out loud rather than filled — through a gap in
an unclosed outline it would otherwise cover everybody. `tests/tools.spec.ts`
asserts both halves of that, and asserts the same tap traces identically twice.

**What the ink floor is for.** `layer_ink()` measures travelled distance, which
is right for a line and wrong for a dot: a stipple mark has no length, so six
hundred of them used to cost nothing and the ink budget — the only thing that
makes a turn finite — stopped applying. Migration 0027 charges a floor of 18 per
mark, the same number the client charges, so neither has to trust the other.

## The return hook

The largest structural gap in the product until now: somebody drew, submitted,
and nothing ever told them the canvas finished.

**A mark is now held by a set of browsers, not one.** The device key was a
bearer token in local storage — clearing it lost your mark, copying it took
your mark — which was an honest trade while nothing was ever *sent* to anybody.
It stops being one the moment a notification says a canvas you drew on has
closed, because "you" then has to survive a browser update.

So there is a **recovery key**: minted by the server, shown once, stored only
as a digest, and good for as many browsers as you like. It is the one
credential this product has. It identifies nobody, it cannot be reset because
there is no email to reset it with, and losing it costs exactly what losing the
device key cost before.

**Two notifications and no others.** Somebody added to a canvas you are on, and
a canvas you are on finished. No digests, no reminders, no "it has been a
while". The hand that closes a canvas does not also get told somebody drew on
it — two pushes about one event is how an app gets muted.

The queue is a table and the sender is a worker, deliberately. A trigger that
made an HTTP call would put a push service on the critical path of somebody
submitting a drawing, which is the one operation here that must not fail for an
unrelated reason. Until the worker is deployed the queue simply fills, and the
moment it runs everyone gets the one notification that is still true.

**Turning it on** is one command:

```bash
scripts/setup-notify.sh            # generate, deploy, prove, schedule
scripts/setup-notify.sh --status   # what it is doing
scripts/setup-notify.sh --off      # stop sending, keep the queue
```

It generates the VAPID keypair and the shared secret rather than asking for
them, stores them as function secrets, deploys the sender, and then **proves
the endpoint answers with the secret and 404s without it before it schedules
anything.** Refusing to schedule an endpoint anybody can poke is the same
lesson as the off-site backup: a wrong value stored without checking does not
announce itself until the first canvas closes, in a job nobody is watching.

The schedule is a function (`schedule_notify`) rather than a `cron.schedule`
written into a migration, because scheduling it needs the project URL and the
shared secret and neither belongs in this repository. The migration carries the
mechanism; the secret lives in the cron row and the function's environment and
nowhere else.

One step is deliberately left to a human, because it is a deploy: the client
needs `VITE_VAPID_PUBLIC_KEY` in Vercel before a browser can subscribe at all.
The script prints it. Until it is set, `/mark` says the build has no push
behind it, which is true and better than a button that fails when tapped.

## Hands, gifts and rooms

**A hand's page** (`/h/<signature>`) is the identity system taken to its
conclusion: the signature *is* the account, so a page of work is the whole of a
profile. No bio, no follower count, no way to send anything. The one thing it
says about a relationship is *you have shared four canvases with this hand*,
which is a set intersection and needs no follow button — and the moment there
is one, this stops being a museum.

**A gifted slot** is the generous version of the share instinct. On a canvas
you have drawn on, you may hold one place for one person: a link, three days,
and the canvas genuinely waits. You cannot broadcast it, there is no counter of
how many you have given, and giving gains you nothing. The relay respects the
hold — `slot_is_free()` is the one question every claim path asks — so a
stranger is never handed a slot somebody just promised to a friend.

**Classrooms** are the one place the product behaves differently, because a
public canvas that strangers draw on is not something a teacher can supervise.
A classroom canvas is never handed out by the relay and never appears in the
gallery or on the map; getting in takes a six-character code read off a
whiteboard. There are still no accounts for children — a mark and a code is the
whole of it, which is what makes it usable in a school rather than a
procurement exercise.

## The museum

**The world map** (`/world`) pins finished canvases where they closed — the
deliberate inversion of a territorial pixel board, which is a map of where your
work is about to be painted over. A pin is a *city*, chosen from a list by the
hand that opened the canvas. Nothing in this product asks a browser where it
is, and there is no location permission prompt anywhere, because a canvas has a
place and a person never does.

The map is an SVG equirectangular projection, which is unfashionable and
exactly right: a few hundred bytes, no tile server, no API key, no third party
watching who looks at what, and it renders identically offline.

**The wall** (`/screen`) is the gallery with no chrome, no controls and no
cursor, cycling finished canvases with the wake lock held. A browser in kiosk
mode on a television is what makes "museum" literal, and it cost almost nothing
because the whole thing was already a web page.

**In the room** (`/ar/<id>`) stands a finished canvas up in front of you.
Viewing only, permanently — drawing in three dimensions does not composite into
a shared flat piece, so it would be a different medium wearing this game's
name. WebXR where it exists; everywhere else the sheet leans with the phone,
which is not AR but is the same gesture and is better than a page saying your
browser is not supported.

**Prints and ink sets are built and unwired.** Both are where money could enter
this product and both are where it is most likely to ruin it, so the constraints
are in the schema rather than in a policy document. An ink set is a selection
from colours that are *already* legal — a trigger refuses one containing
anything else, because the day somebody wants to sell an advantage the schema
has to be the thing that says no. A print asks every contributor and is only
made when all of them have said yes; one no ends it. Neither `price_pence` nor
`paid_at` is read or written by anything: **wiring them needs a Stripe account
and a print vendor, which is not something code in this repository can
conjure.** Until then a set can be granted by hand and a print request is a
queue an operator reads, which is genuinely how the first ones should be
filled.

## Hand feel

The things that decide whether a drawing surface reads as native or as a web
page. All four are covered by `tests/surface.spec.ts`, which runs in Playwright
because they depend on requestAnimationFrame actually firing and browsers freeze
it in a hidden tab.

**Prediction.** Two lags stack between finger and ink: the smoothing filter
holds the recorded path back, and the recorded path is always a frame old. The
visible tip is drawn to the raw position plus a short velocity extrapolation —
about 38 logical px ahead in practice. It is display only, never recorded, so a
bad guess lasts one frame and leaves nothing behind.

**Inertia and rubber-banding.** A two-finger pan throws and coasts to a stop;
the sheet gives at the edges with resistance that grows as it goes, and springs
back on release. Velocity is measured across a 90ms window rather than between
events, because two fingers emit two moves per frame microseconds apart and
dividing a frame's travel by that gap reports a speed nobody moved at. Stopping
dead at the edge was the most web-feeling thing left in the app.

**Two-finger tap undoes. Two-finger double-tap fits.** Single-tap gestures are
deliberately untouched — a one-finger tap is a dot, so stealing double-tap for
zoom would leave two dots behind every time.

**A failed save never costs the drawing.** Submitting stays on the drawing
screen; a rejection appears as a banner over work that is still there, still
undoable, still submittable. Swapping to an error screen would have thrown away
a turn over a dropped connection.

## Colour

Sixteen families of five, plus any hue you like.

**Long-press a swatch** to fan out its two shades and two tints — eighty colours
reached through sixteen, with no second row eating the sheet's vertical space.

**The mix swatch** gives the whole hue wheel with saturation and lightness
fenced to the range measured from the sixteen (S 18–72, L 28–72). Any colour you
like, in this world's light. The hue strip itself only shows achievable colours,
so the constraint is visible rather than enforced by rejection.

There is no hex field, on purpose. A typed colour is a text input, which the
brief rules out, and an unrestricted one puts a stroke that cannot sit with the
others into an archive that can never be edited.

`colour_allowed()` enforces exactly the same rule server-side —
`tests/colour.spec.ts` asserts the client derives byte-identical families to the
ones stored in `palette_colors`, so the UI can never offer a colour that gets
refused after the drawing is finished.

## Installing

Real icons, a maskable variant, an apple-touch-icon, and shortcuts — generated
by `node scripts/make-icons.mjs` so the mark stays in step with the palette.

`public/sw.js` caches the app shell. Deliberately conservative: content-hashed
assets are cached forever, navigations go network-first so a stale index.html
can never pin someone to an old bundle, and **nothing from the ledger is ever
cached** — a canvas that looks finished because it was finished yesterday would
be a lie. Registered in production only.

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

One advisory warning remains and is meant to: `claim_turn`, `submit_turn` and
`report_content` are `SECURITY DEFINER` and callable by `anon`. v1 has no
accounts, so that is the product, and each carries a `COMMENT ON` saying so.
`open_or_join_canvas` used to be on that list and no longer is — 0018 took its
grant away, because it has been dead since 0004 and an unused write path
reachable by strangers is surface for nothing in return.

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

## The rules are the server's, not the client's

Two game rules used to live only in the UI, which made them suggestions:

**Colour.** `submit_turn` refuses any colour the turn was not offered, checked
against the palette stored on the turn at claim time. A mixed layer is refused
whole, not filtered.

**Ink.** `layer_ink()` recomputes stroke length in Postgres from the submitted
points, and a layer over the canvas's budget is refused. The client's claimed
figure is never trusted — `layers.ink_used` is the server's number. Verified: a
known 1000px line measures exactly 1000, a live layer the client measured at
2246 stored as 2246, and a client claiming 999,999 for a 1000px line had its
claim discarded.

`canvases.ink_budget` travels with the canvas for the same reason `width` and
`height` do — a closed canvas has to stay judged by the rules it was played
under, and the server must not depend on a constant in a JS bundle.

## Backups

The hosting tier includes none, and the archive is the one thing here that
cannot be regenerated from this repo. So `.github/workflows/backup.yml` dumps it
nightly at 03:20 UTC, checks it, and keeps thirty days of snapshots as private
GitHub Actions artifacts.

**Setup, once.** The workflow needs a connection string in
*Settings → Secrets and variables → Actions* as `SUPABASE_DB_URL`. It is never
in the repo and never printed by any step.

Take the **Session pooler** string from the Supabase dashboard
(*Project Settings → Database → Connection string → Session*), not the direct
one. Direct connections to `db.<ref>.supabase.co` resolve to IPv6 only, and
GitHub's runners are IPv4 — the first scheduled run would fail for a reason that
looks nothing like the actual cause. The session pooler speaks the full protocol,
so `pg_dump` works against it; the transaction pooler does not.

**Version pinning.** `PG_MAJOR` is set in one place in the workflow and the
matching client is installed from the PGDG repository. The runner also ships its
own client — 16 while the server is 17 — and both end up under
`/usr/lib/postgresql/`, so the workflow exports absolute paths to the pinned
binaries rather than trusting PATH order. The script checks the client's major
version against `server_version_num` **before** it reads anything, so a mismatch
is the first line of the log rather than something that surfaces halfway
through looking like a database problem.

The pin is also the alarm for the upgrade nobody schedules: when Supabase moves
to 18, the preflight stops the job with an explicit "the pin has to move"
message instead of quietly producing dumps that cannot be restored.

**Errors are reported, not paraphrased.** Every failure prints what postgres
actually said underneath the friendly summary, with any password stripped out.
An earlier version swallowed `psql`'s stderr and replaced it with a guess; the
guess was wrong, and a pooler username problem cost two rounds of debugging that
the database had already described precisely. This is meant to run unattended
for years — it has to be able to explain itself.

**What "verified" means here.** Checking the file size catches a zero-byte dump
and nothing else — a dump that stopped halfway through the layers table is a
perfectly plausible forty kilobytes. So the backup reads the live row counts
first, then counts the rows *inside* the finished dump, and fails if any table
disagrees. It also refuses to write a backup when the database reports zero
layers, and refuses one less than half the size of the previous night's, since
an append-only archive should never shrink. A failed run deletes its own output
rather than leaving a broken file that looks like a good one, and opens a GitHub
issue — one issue, reused, so a fortnight of failures doesn't become fourteen
notifications you stop reading.

Proven by breaking it deliberately:

| what was done to the dump | caught by |
|---|---|
| stopped at 60% of the file | 3 tables short |
| complete, but 3 layer rows removed | layers 9, expected 12 |
| database emptied first | refuses at 0 layers |
| restore aimed at the live project | refuses on the ref |
| client 16 against a 17 server | preflight, before anything is read |
| server upgraded past the pin | preflight, with the pin to change |
| wrong username / unreachable host | the actual `psql` error, password stripped |

### Restoring

Two files come out each night. `-data.sql.gz` is what a restore loads;
`-schema.sql.gz` is carried so the artifact explains itself years later without
the repo at that commit.

The data dump is `--data-only` deliberately. A combined schema+data dump carries
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin`, which the role performing the
restore is not permitted to execute — so the obvious single-file dump is exactly
the one that fails at the moment you need it. Schema comes from
`supabase/migrations` instead, which is verified to build from nothing.

```bash
# 1. get the schema in place — extensions, grants, triggers, the cron sweep
supabase db reset                    # local
# or apply supabase/migrations/*.sql in order against a fresh project

# 2. load the archive, asserting what you expect to find
EXPECT_CANVASES=1 EXPECT_LAYERS=12 \
  npm run restore -- backups/longhand-2026-08-03-data.sql.gz
```

`restore.sh` truncates the target before loading, so it is repeatable, and it
**refuses to run against the live project** — that refusal is the only thing
between a mistyped URL and the destruction of the history the backup exists to
protect.

It verifies more than row counts, because rows arriving proves nothing about
whether the drawings survived: it sums the strokes and points inside the
restored `layers`, and checks the append-only trigger came back armed.

### The artifact itself

Everything about the backup was verified except the last link. The nightly job
checks its own dump, and the restore drill had been run — but against a dump
produced locally, on the same machine, minutes earlier. What had never been
exercised was the artifact: the file that would actually be reached for,
downloaded from where it actually lives, onto a machine that is not the one that
made it. That gap is where backups die, because everything upstream can be green
while the thing you would restore from is a zip nobody has ever opened.

```bash
scripts/verify-artifact.sh                    # newest successful run
scripts/verify-artifact.sh --restore          # and load it into a local stack
scripts/verify-artifact.sh --file <dump.gz>   # one you already have
```

It downloads with `gh`, counts the rows inside the dump with the same COPY-block
walk `backup.sh` uses — deliberately the same, so that if the two ever disagree
it is clear one of them is reading the format wrong — and then checks the thing
row counts cannot: that every layer row actually carries strokes, and that those
strokes carry points. Rows arriving proves nothing about whether the drawings
did. With `--restore` it hands the file to `restore.sh`, which is the whole
drill against a real artifact rather than a local rehearsal of it.

`--file` skips the download, which is how the off-site copy gets the same
treatment: pull an object out of the bucket and point this at it.

**It found something the first time it ran.** `canvas_formats` was missing from
the truncate list in `restore.sh`, so restoring into a schema built from
migrations collided on a duplicate key — the migration fills that table, and the
dump filled it again. `reports` and `moderation_actions` were missing from both
scripts for the same reason. That is precisely the class of bug this exists to
find: invisible until the day you need the backup, and by then it is the worst
possible day to find it.

### Practised, not assumed

Run end to end on 2026-08-03 against a local stack holding the same content as
production:

```
seed → backup → supabase db reset (canvases=0 layers=0) → restore
  canvases 1 · layers 12 · signatures 12 · turns 12 · seeds 12 · palette 80
  strokes 95 · points 2891 · append-only armed
```

Matching production's counts exactly.

Production has since been dumped for real. The run on 2026-08-05 reported
1 canvas and 12 layers, wrote a 42,456-byte compressed dump, and copied it
off-site — so both halves of the nightly job are exercised against the live
archive rather than a rehearsal of it.

### The off-site copy

**Configured and landing.** The 2026-08-05 run copied both files to the bucket
and read them back to check their sizes — 42,456 and 6,709 bytes — so the
archive has genuinely stopped living in one failure domain. That was the second
half of the backup closeout and it is done.

Artifacts protect against losing the Supabase project. They protect against
nothing else, because the repository and its artifacts share a failure domain
completely — one compromised or closed GitHub account takes both.

So the workflow also copies each night's dump to an S3-compatible bucket, if one
is configured. S3-compatible rather than a specific provider, so the destination
stays a choice: Cloudflare R2 and Backblaze B2 both have free tiers that fit an
archive measured in tens of kilobytes, and AWS S3, Wasabi or a MinIO box all
work unchanged.

Set it up with:

```bash
scripts/setup-offsite.sh
```

It asks for the four values, proves they actually work against the bucket — the
same write, read, list and delete the nightly job performs — and only then
stores them. Proving first is the point: a mistyped key stored without checking
does not announce itself until 03:20 tomorrow, in a job nobody is watching. Keys
are never echoed, never written to disk, and are piped to `gh` rather than passed
as arguments, since argv is visible to anything that can run `ps`. Use
`--dry-run` to check credentials without storing them.

The R2 token needs **Object Read & Write scoped to the one bucket** and nothing
more — this job never creates or deletes buckets.

The secrets it sets, if you would rather add them by hand. Only the first three
are required:

```
BACKUP_S3_BUCKET              longhand-archive
BACKUP_S3_ACCESS_KEY_ID       …
BACKUP_S3_SECRET_ACCESS_KEY   …
BACKUP_S3_ENDPOINT            https://<account>.r2.cloudflarestorage.com
BACKUP_S3_REGION              auto        (default; correct for R2)
BACKUP_S3_PREFIX              longhand    (default)
```

**Until they exist the job still succeeds, but says so every night** — a warning
annotation on every run reading *"Archive has only one copy"*. Unconfigured is a
decision, and it should keep being visible rather than settling into silence. A
destination that *is* configured and fails is a hard failure, because that is
something broken rather than something not yet chosen.

Every upload is read back and its size compared before the run is called a
success — a truncated upload is the same class of problem as a truncated dump.
Pruning keeps the newest thirty days and refuses outright if it would remove
more than ten objects at once, since a normal night retires two and anything
wholesale means the naming or the listing changed shape. Deleting backups on a
guess is not something a script should do.

A bucket lifecycle rule would also work for expiry and needs no code. The prune
is in the job so that the whole thing is described in one place and cannot be
half-configured, but if you would rather set a 30-day rule in the provider,
delete the prune and nothing else changes.

## Rules for operating on the ledger

Two, and they are not stylistic.

**Never disable `layers_append_only_trg`.** Append-only is the product's one
irreversible promise, and a trigger stood down "just for a moment" is a promise
that held until it was inconvenient. If test rows need clearing from a
*throwaway* project, `TRUNCATE` does it without touching the trigger, because
TRUNCATE fires statement triggers and this one is per-row. On a live archive
nothing is cleared at all: hide the layer.

I broke this rule once, standing the trigger down to delete a canvas an API test
had opened on the live project. It was re-armed immediately and verified, but it
should not have happened — the test should not have been able to write there.
That is what the guards below now prevent.

**Tests cannot reach the live archive.** The database-backed specs read
`TEST_SUPABASE_URL` / `TEST_SUPABASE_PUBLISHABLE_KEY` from `.env.test.local`,
and `tests/support/ledger.ts` refuses to run if they are missing, if they name a
protected project ref, or if they match the app's own `VITE_SUPABASE_URL`.
Missing credentials fail the run rather than skipping it — a skipped safety test
reads as green.

Point them at a **local** stack, not a second cloud project:

```bash
supabase start   # prints a URL and anon key for .env.test.local
```

Free, ephemeral, and it cannot be production by construction. Docker comes from
Colima here (`brew install colima docker supabase/tap/supabase`, then
`colima start`), which needs no admin password.

Building the schema from scratch this way immediately paid for itself — see
below.

## What building from scratch found

The repo did not reproduce the database, in two ways, and neither was visible
from the hosted project because the hosted project already had the state.

**Three migrations existed only in the cloud.** `tints_shades_and_gamut`,
`colour_gamut` and `submit_turn_uses_colour_allowed` had been applied through
the management API without ever being written to `supabase/migrations`. A fresh
deploy would have come up with sixteen colours instead of eighty, no gamut
function, and a `submit_turn` that never checked a colour. They are now files
0011–0013.

**No grant was ever written down.** Every table was readable only because the
hosted platform implicitly grants `SELECT` on new tables in `public` to `anon`.
Built locally from the same migrations, `anon` could not read a single row and
the app came up dead. 0015 states the read paths explicitly.

The same audit showed `anon` held `INSERT`, `UPDATE` and `DELETE` on
`canvases`, `layers`, `turns` and `signatures` in production. Nothing could use
them — RLS defines no write policy, and that was verified by attacking the
endpoint — but they were one accidental policy away from mattering. 0015 and
0016 revoke them, and default privileges no longer hand them to future tables.
Writes go through the security-definer functions, which is the only path that
was ever intended.

```bash
npm run test:app      # everything that needs only a browser
npm run test:ledger   # needs the throwaway project
npm test              # both
```

`tests/colour.spec.ts` touches no database at all — it is pure client maths
checked against a copy of the migration. The check that the client has not
drifted from the *actual* `palette_colors` table lives in `tests/ledger.spec.ts`,
where a database dependency belongs.

The split is by what a spec needs, and it is declared once in
`playwright.config.ts`. A spec that writes rows has to be named there; left out,
it lands in `app`, where it fails for want of credentials — loudly, which is the
right failure, but it fails a run that is meant to need nothing but a browser.

| spec | needs | what it holds |
|---|---|---|
| `surface` | a browser | prediction, inertia, rubber-banding, two-finger undo |
| `replay` | a browser | the timelapse walk is pixel-exact at any step count |
| `video` | a browser | a real file comes out of the export |
| `colour` | a browser | the client's eighty colours against a copy of the migration |
| `onboarding` | a browser | the first visit, which is otherwise invisible once seen |
| `ledger` | a database | the ink budget and the palette, against the real endpoint |
| `tools` | a browser | a fill stays inside a shape, refuses to escape one, and traces the same way twice |
| `formats` | a database | duos close; the moderation levers are unreachable by clients |

## Known gaps

**The storage keys still say `longhand`.** `longhand.device.v1`,
`longhand.signature-id.v1`, `longhand.recovery.v1`, `longhand.signature.v1` and
`longhand.welcomed.v1` kept their names through the rename to Foolscap, on
purpose. They are internal and never seen; renaming them would log out every
existing browser for no gain, which is the same origin-scoping problem as
moving domains and with none of the benefit. If they are ever renamed it has to
be a migration that reads the old key and writes the new one, not a find and
replace.

**The device key is a bearer token in local storage.** Clearing it no longer
loses a mark — that is what B1's recovery key is for, minted on request, shown
once, stored only as a digest — but that only helps somebody who took one.

Copying a device key still takes over a mark, and redeeming a recovery key does
not revoke it: `redeem_recovery_key` adds a row to `signature_devices`, so the
copied key keeps working alongside the new one. Revocation is what an account
would buy, and not buying one is the product. This stays on the list as the
known cost of that.

**Claiming has a floor now, and it is a blunt one.** One active turn per mark
was always enforced — `claim_turn` resumes rather than issuing a second — so
the gap was making marks, which is one insert with a squiggle. 0031 caps new
claims per address per hour, using the one thing the client cannot forge: the
address the platform saw.

The address is never stored. It is salted with a secret the database generated
for itself, kept as a digest, and rows older than the window are deleted on
every call — this product has never kept a record of who visited and should not
start in exchange for this.

Classrooms are deliberately exempt: `claim_classroom_turn` is a separate
function and does not call the throttle. Twenty-four children on one school
connection are one address, and a limit that could not tell the difference
would break classrooms while looking like it worked.

Limits live in `claim_limits` — 30 an hour by default — because anything an
operator might change at 9pm on a Saturday should not be a deploy.
`claim_throttle_health()` exists to catch the real failure, which is not the
limit firing but the limit never firing because no address ever arrives.

**Testing a close still takes real browsers, but far fewer.** A duo needs two,
not twelve, which makes the whole loop — fill, close, timelapse, video, gallery
— reachable in a single sitting with one other person for the first time.

**Palette inheritance is off, and that is a decision rather than a gap.** It is
recorded here because the reasoning is easy to lose and the mechanic is still
live behind a dial.

It used to ration which of the sixteen each player could touch, inheriting from
what had been *submitted*. It never survived a burst: the palette is fixed at
claim time — correctly, so it cannot shift under someone mid-drawing — so
twelve people arriving on a shared link all claimed before anyone submitted and
all got the full set anyway. Seeding a canvas reproduced it exactly.

`0010_full_palette.sql` turned it off, and that practical failure was the
smaller of its two reasons. Cohesion comes from the sixteen being hand-picked
muted tones that cannot clash badly, not from rationing which of them a player
may use. The restriction was a second-order rule on top of an already-strong
one, and it cost the last players their range for very little.

Switched off rather than deleted: `p_floor` in `inherited_palette` is the dial.
16 tops everyone up to the full set (off), 6 restores a floor, 0 is the brief's
literal rule. It must agree with `PALETTE_MIN` in `src/config.ts`, because
`submit_turn` rejects any colour a turn was not offered.

**Losing an unsubmitted drawing at 10:00 is harsh.** It is what the brief
specifies, and the clock is visible throughout — but auto-submitting non-empty
work would keep the canvas moving *and* not destroy anything. Worth a decision
after real strangers hit it.

**An unsubmitted drawing now survives a reload.** It did not until
`src/data/draft.ts`, and the failure was silent: the turn resumed on the same
slot with the same time left, correctly, but the sheet came back empty. The
strokes had only ever lived in the surface's memory.

Kept in `localStorage`, through the same codec a layer is submitted through,
so what comes back is exactly what would have been sent — a draft that
restored more faithfully than submit would be a lie about what you had. Saved
on a 500ms debounce, and flushed immediately on `pagehide` and on the tab
going hidden, because the debounce is otherwise a window in which a phone can
take the tab away. Cleared on a *successful* submit, not on the tap: clearing
early would mean a dropped connection took both the save and the only other
copy.

Restoring is refused unless the canvas, the slot, the expiry *and* the sheet
size all match, so a slot that expired and was claimed again does not come
back wearing last week's drawing.

None of this is the ledger. Nothing here is sent anywhere and a draft has no
bearing on when work becomes real — that is still submit, and only submit.

One thing it does not survive: two tabs on two canvases overwrite each other's
draft, since one draft is kept at a time. The turn key means the survivor
still restores to the right turn and the other simply does not come back,
which is what happened to both before any of this existed.

**Testing a close alone is still impossible on the ledger.** One hand per canvas
is enforced in the database, so watching a canvas fill takes real browsers —
which is the brief's success criterion, not an obstacle to route around. Run
without Supabase credentials for a solo relay when you only want to exercise the
surface.

**Nothing tells a contributor their canvas finished — yet.** The queue, the
sender and the schedule are all built (B1), and the sender is deployed to
production. It is not sending: it has no VAPID keys and nothing is scheduled,
so the review screen still says to keep the link, which stays the honest
instruction until the keys are in.

Nothing is lost while it is off. The queue is a table precisely so that a
sender which is not running costs only delay. `docs/deploy.md` §2 is what turns
it on.

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

It asks for a twelve explicitly. Without that the ledger would send each hand to
whatever is closest to closing, which is right for a player and wrong for a
seed — the twelve fixture layers are one scene and belong on one sheet.

The scene itself lives in `scripts/scene.mjs`, because `make-welcome.mjs` bakes
the same twelve hands into the clip on the welcome screen and the two must not
drift:

```bash
node scripts/make-welcome.mjs    # regenerates public/welcome-canvas.json
```

## The share image

`/c/<id>` names the canvas in a shared link's title and description; `/c/<id>/card.png`
is the picture beside them. Until it existed, a finished drawing and a link to
the terms page previewed identically — the app icon and the word Foolscap.

The rule that shaped it: the preview must not be a second, subtly different
renderer. A canvas is a few tens of KB of stroke vectors, and the app turns
those into pixels through exactly one path — `decodeLayer`, then `drawLayers`.
`api/og.ts` calls the same two functions against a Skia canvas
(`@napi-rs/canvas`) instead of a browser one, so what scrolls past in a chat is
what the artist saw in their hand. A hand-written SVG translation would have
been lighter and would have drifted the first time a wash multiplied or a fill
kept its holes; the whole point of storing a fill as a polygon rather than a
seed point was that a polygon is a fact, and the same reasoning forbids a
second renderer here.

The canvas is square and every platform wants 1.91:1, so the drawing sits on a
wider sheet of the same paper — which reads as a mounted drawing rather than a
letterbox, and wants no cropping and no decision about which third of a square
to discard. One transform maps the 2048 sheet into the centred square, the same
arrangement `renderLayers` uses in the browser.

It is a Node function, not edge like `api/canvas.ts`, for one reason: the
rasteriser is a native module and edge has none. Anything that is not a listed
canvas with a hand on it — a bad id, a private canvas, a blank sheet, a database
blip — falls back to the app icon, so a link always previews as *some* valid
image rather than a broken-image glyph. A closed canvas can never change, so its
card is cached for a year; an open one gains hands, so its card is allowed to go
stale within the minute. `og:image` only points here once `slots_filled` clears
one, because a blank sheet previews worse than the mark that says what the app
is.

Verified by rendering a real finished canvas — twelve hands, a harbour — through
the exact `decodeLayer`/`drawLayers` path this ships, and against a synthetic
layer exercising the wash's multiply and the fill's even-odd holes, which are
the two things a naive rasteriser gets wrong.

The first deploy failed, and not where expected. The native module loaded fine;
what threw was module resolution. `package.json` is `"type": "module"`, so
Vercel runs the compiled `api/og.js` under Node's native ESM loader, which
refuses a relative import with no extension. tsc, Vite and esbuild all accept
`../src/engine/render`; Node does not, and Vercel transpiles these files rather
than bundling them, so the extensionless specifier reached production and threw
`ERR_MODULE_NOT_FOUND` on the first request — a build that went green and a
function that could not import itself. The fix is `.js` on the function's
relative imports, and on the one transitive import `render.ts` pulls in
(`../config`), because the compiled files are `.js` and that is what the
specifier must name. Proved before the second deploy by emitting the function to
plain JavaScript and loading it under `node` directly, which is the loader
Vercel uses and the one tsc and Vite do not.

The second deploy surfaced the second Node-versus-edge difference. `api/canvas.ts`
is an edge function, where `request.url` is absolute; `api/og.ts` is a Node
function, where it is the path alone, so `new URL(request.url)` threw
`Invalid URL` on every request. The origin is rebuilt from the forwarded host
instead — which is also the origin the fallback icon is fetched from, so it has
to be the real one. This time the whole function was simulated before deploying:
emitted, its `fetch` stubbed with a real canvas's rows, and called with a
path-only request carrying a host header — the exact shape Vercel delivers —
which returned a 200 image/png of the right drawing. The lesson, written down:
a Node serverless function is not an edge function with a different `runtime`
line, and the two places that bite are module resolution and the request.

## Not built yet

**A server-side video.** The still image is done (see *The share image*), but
the *timelapse* export still runs in the player's browser, which is fine for
someone saving their own canvas and no use for a video of a canvas nobody has
opened. The still proves the render path works server-side; the video is the
same walk over the same data and wants the same treatment, plus a muxer, which
is the piece that makes it a worker rather than a request.

Accounts. The world map, prints and school accounts are built but Phase C, and
all gated on the archive being worth something first.

Notifications are built and deployed but not sending — see Known gaps above,
and `docs/deploy.md` §2 for the two things still missing, both of which are
credentials rather than code.

## Before this goes in front of strangers

Everything on the roadmap is built, and **it is deployed**. Production is at
migration 0029, the client is live, and the seeds are in — 5 formats, 41
places, 4 ink sets. `docs/deploy.md` is the record of how it went, including
the three faults that only a real Supabase could have shown — the third of
which, in 0030, meant nobody could sign at all.

One thing to settle before a *public* launch, as opposed to a playtest:
**pointing foolscap.ink at Vercel.** The domain is bought and the name is
decided; what is left is the DNS and the Vercel domain setting.

Do it before collecting anything. Identity, push subscriptions and the service
worker are all scoped to the origin, and everything that makes somebody a
returning person lives in `localStorage`. Every visitor who arrives on
`longhand-kappa.vercel.app` and returns after the move arrives as a new device
with no mark, and every push subscription taken until then is discarded. The
canvases themselves are server-side and survive a move; only the browser's
claim to them breaks, and only a recovery key carries that across. Free today
at 0 subscriptions. Unfixable later for anyone who did not take a key.

A playtest does not need it. Run one on the Vercel URL, treat tester identity
as disposable, and nothing is lost that was not already disposable.

What is left is not code:

1. **Close a duo first, with one other person.** Two real browsers is the
   cheapest thing that exercises the whole loop — claim, draw, submit, close,
   timelapse, gallery — and nothing has done that yet. It is a single sitting,
   and it will find more than another read-through would.
2. **Run the twelve-stranger test.** Post the link where strangers are — not
   friends, not an audience, not anyone who knows the work, because they will be
   generous and tell you it is great, and that test is worthless. Run three or
   four canvases on identical settings before tuning anything, or you are
   reading noise.
3. **Watch the timelapses before reading any feedback.** The question is whether
   you want to send one to someone.
4. **Close the phone half of `docs/friction.md`.** Hand feel is the one thing no
   agent can judge, and that list names exactly which questions are waiting for
   a real device. The tools add to it: whether a stamp lands where a thumb
   expects, whether a wash reads as a wash on a phone screen in daylight, and
   whether the fill's refusal message arrives fast enough to feel like an
   answer rather than a failure.
5. **Decide what to turn off.** Every branch of B2 shipped because the gate was
   skipped, which is more tools than the gate would have chosen. If the first
   canvases come back as noise, the answer is to set a tool's chip aside rather
   than to tune it — the tray is one array in `DrawTurn.tsx`.

Two things need credentials nobody here can mint: **a VAPID keypair and a
contact address** before any notification sends, and **a payment processor and
a print vendor** before a print or an ink set can be sold. Both are built up to
exactly that line and stop there.

The keypair is a browser console away and needs nothing installed —
`docs/deploy.md` §2. The contact address is the part worth thinking about,
because it travels to Apple and Google in every push, which is one more reason
the domain comes first.
