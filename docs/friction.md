# The friction list

Written before anything was fixed, from a cold walk through the whole flow —
arrive, sign, draw, submit, land on the canvas page — at 390×844, which is a
phone-sized viewport rather than a phone.

That distinction matters and it is the reason this list has two halves. An
agent can see that a screen is unbalanced, that a string is wrong, that a
control is unreachable in a scroll container. It cannot feel latency in a
stroke, judge whether a taper looks like ink, or notice that a button is
half a centimetre from where a thumb naturally lands. Those stay open, marked
**phone**, and only Michael can close them.

Numbers in the first column are the order they were hit, not their severity.

## Fixed in this pass

| # | Where | What was wrong |
|---|---|---|
| 1 | Arrival | A first-time visitor was dropped on the signature pad with no idea what they had arrived at. Now the welcome screen, once, led by the clip. |
| 2 | Welcome | The clip showed the whole square sheet, so a third of it was empty sky and the reader had to scroll before reaching the button. Cropped to the band the drawing is actually in. |
| 3 | Welcome | Three promises pushed the button below the fold. The signature one moved to the screen that actually asks for a signature, where it answers the question at the moment it is asked. |
| 4 | Signature | The pad sat at the top of a tall screen with several hundred pixels of nothing under it, and the actions floated in the middle of that nothing. Actions now sit at the bottom, where a thumb is. |
| 5 | Signature | "Sign once. It travels with everything you draw" explained the mechanics and not the point. It now says what a signature is *for* — credit — and that nothing is being asked about who you are. |
| 6 | Draw | The slot count was hardcoded to twelve, so a duo would have read "Slot 1 / 12" while closing at two. |
| 7 | Draw | Nothing on the sheet let a player say that something already on it was wrong. Report control, bottom right, only once somebody else's work is there to report. |
| 8 | Submit | "Locked" as a heading, with the canvas state underneath. The moment after submitting is the one moment the player is owed a sentence about what happens next; it now leads with what they did and says how many hands are left. |
| 9 | Submit | Nothing told a player their canvas page is the only thing that will ever tell them it finished. Notifications are Phase B, so until then the honest instruction is to keep the link. |
| 10 | Submit | "Ledger · 3 strokes · 196 points · 3.9 KB encoded" is a developer's line. Kept, because permanence is the product, but retitled and de-jargoned. |
| 11 | Canvas page | An open canvas showed nothing about the slots still empty, so it read as a finished canvas that was somehow short. Empty slots are now drawn as waiting cards. |
| 12 | Canvas page | Per-hand cards were captioned "N / 12" from a constant rather than from the canvas. |
| 13 | Canvas page | No way to report anything. Now one control for the canvas and one on each hand. |
| 14 | Gallery | "Canvases that twelve hands finished" and "the first canvas to reach twelve hands" were both wrong the moment duos existed. |
| 15 | Gallery | The empty state said nothing would land there until twelve hands arrived, which reads as "come back in a month". It now says a duo needs two. |
| 16 | Everywhere | Terms and the safety position were unreachable from inside the product. Quiet footer on every screen that is not the sheet. |
| 17 | Everywhere | Scrollable panels ran their last line into the action row with no gap, so text looked cut off rather than scrolled. |
| 18 | Copy | An audit of every string for the voice: no exclamation marks, nothing congratulatory, nothing hurried. |

## Still open, and only a phone can close them

| Where | What to check |
|---|---|
| Draw | Whether the report control at bottom right is ever hit by accident with the heel of a thumb mid-stroke. If it is, it moves. |
| Draw | Whether the tool column at the right edge is reachable one-handed on a large phone, or whether it wants to be at the bottom. |
| Draw | Whether ten minutes reads as generous or as pressure once there is a real drawing at stake rather than a test scribble. |
| Welcome | Whether six seconds is long enough to understand the clip, or whether it needs eight. It is one constant in `WelcomeReel`. |
| Welcome | Whether the clip should crop tighter still on a small phone. |
| Signature | Whether the signature box is tall enough to sign in comfortably with a finger. |
| Review | Whether the round trip through review is worth the tap it costs, or whether landing straight on the canvas page would be better. |
| Everywhere | Whether the view transitions read as calm or as lag. |

## Deliberately not fixed

- **The tuner panel** (`?tune=1`) is developer furniture and stays as it is.
- **The self-test page** likewise.
- **The layer JSON download** on the review screen looks like a developer
  feature and is one, but it is also the only way a contributor can take the
  raw thing they made away with them, which is a promise worth keeping.
- **The ink meter reading 100% before a single stroke.** It is accurate, and
  a meter that starts at anything else would be decoration.
