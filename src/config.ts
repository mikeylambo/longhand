// Locked v1 parameters from the brief, plus the hand-feel constants that the
// brief says to tune in playtest. Everything tunable lives here and is
// overridable from the URL (?ink=6000&speedRef=1.2) so a tuning session on a
// real phone doesn't need a rebuild.

/**
 * The sheet is square.
 *
 * The brief locked 2048×1536, which is print-shaped but wrong for the device
 * almost everyone will draw on: a 4:3 landscape sheet fitted into a portrait
 * phone is a band across the middle with dead space above and below, and the
 * first thing a new player sees is a strip rather than a surface. Square fills
 * the width, keeps the same rough area, and is still print-viable at 1.0.
 */
export const CANVAS_W = 2048
export const CANVAS_H = 2048

export const SLOTS_PER_CANVAS = 12
export const TURN_MS = 10 * 60 * 1000

/**
 * The sizes a canvas can be opened at.
 *
 * Twelve is the brief and stays the flagship. Duos and quartets exist because
 * of arithmetic rather than variety: with a small population a twelve may
 * never close, and a stranger who draws into a canvas that never closes gets
 * one twelfth of the product — no finished piece, no timelapse, no video, no
 * hand of their own on bare paper. A duo closes with one other person.
 *
 * `canvas_formats` in the database is the authority: it decides what may be
 * asked for and what share of new canvases opens at each size. These names are
 * only how the sizes are *spoken*, which belongs next to the rest of the copy.
 * tests/ledger.spec.ts asserts every format in the table has a name here.
 */
export const FORMATS: readonly Format[] = [
  { slots: 2, name: 'a duo', title: 'Duo', hands: 'two' },
  { slots: 4, name: 'a quartet', title: 'Quartet', hands: 'four' },
  { slots: 12, name: 'twelve hands', title: 'Twelve hands', hands: 'twelve' },
  // Weight 0 in `canvas_formats`: the rotation never opens one, so these exist
  // only for somebody who asks. They were in the table from 0019 and named
  // nowhere, which meant a 24-hand canvas rendered as "24 hands" in the
  // gallery and could not be asked for at all — built, and unreachable.
  { slots: 24, name: 'a classroom', title: 'Classroom', hands: 'twenty-four', onRequest: true },
  { slots: 100, name: 'a marathon', title: 'Marathon', hands: 'a hundred', onRequest: true },
]

export interface Format {
  slots: number
  name: string
  title: string
  hands: string
  /** Never opened by the rotation. Offered apart from the rest, because
   *  a hundred hands is a different kind of commitment from two and should
   *  not sit in the same row as if it were the same choice. */
  onRequest?: boolean
}

/**
 * A size the client has never heard of still has to read as English, because
 * the table can gain a format without a deploy — that is the point of it being
 * a table.
 */
export function formatFor(slots: number): Format {
  return (
    FORMATS.find((f) => f.slots === slots) ?? {
      slots,
      name: `${slots} hands`,
      title: `${slots} hands`,
      hands: String(slots),
    }
  )
}

/** Paper. Everything composites additively over this and never subtracts. */
export const PAPER = '#F2EDE3'

/**
 * The 16-colour master palette. Muted, gouache-ish, no neon — twelve strangers
 * with a saturated palette produce noise, not a picture. Palette inheritance
 * (v1, milestone 3) draws from this list.
 */
export const MASTER_PALETTE = [
  '#1B1A17', // ink
  '#5B5850', // graphite
  '#9C978B', // ash
  '#FBF8F1', // chalk
  '#A73A34', // deep red
  '#DD6238', // vermilion
  '#E5A23C', // amber
  '#B8873C', // ochre
  '#7C8A47', // olive
  '#48764F', // fern
  '#2C7A73', // teal
  '#3B6288', // slate blue
  '#2B3A72', // ultramarine
  '#6A4B82', // violet
  '#A94578', // magenta
  '#E3A59C', // blush
] as const

/** Thin / medium / broad, in logical canvas px. */
export const PEN_WIDTHS = [3.5, 9, 20] as const

/**
 * Palette inheritance — currently off.
 *
 * The brief made it the headline cohesion mechanic: each player gets the
 * colours already on the canvas plus two new ones. Two things argued it down.
 * It collapses under a burst of arrivals anyway, because the palette is fixed
 * at claim time and inherits from what has been *submitted* — twelve people who
 * all claim before anyone submits are each offered everything regardless. And
 * the real constraint was never *which* of the sixteen: it is that all sixteen
 * are hand-picked muted tones that cannot clash badly. Restricting the subset
 * was a second-order rule on top of an already-strong one, and it cost the
 * twelfth player their range for very little.
 *
 * PALETTE_MIN = 16 means "top every player up to the full set", i.e. off. Drop
 * it to 6 to bring inheritance back with a floor, or 0 for the brief's literal
 * rule. `inherited_palette()` in the database carries the same number and both
 * must agree — the server rejects colours a turn was not offered.
 */
export const PALETTE_NEW_PER_SLOT = 2
export const PALETTE_MIN = 16

export const DEFAULT_TUNING = {
  /**
   * Total stroke length, in logical px, for one turn. The pen runs out.
   *
   * The brief locked this at 4000. Milestone 1 measured a single arc across
   * the sheet at 3076 — one and a half gestures per player — so it went to
   * 14000, then to 10000 once there were real numbers to tune against: a
   * stick figure at phone scale costs ~4300, and one dense scribbled stroke
   * from a live layer cost 10909. 10000 buys a considered contribution and
   * makes a careless one cost something.
   */
  inkBudget: 10000,
  /**
   * The least a layer can be and still be a contribution.
   *
   * A slot is a twelfth of somebody's canvas and it is gone once used, so a
   * single tap should not be able to spend one. This is stroke length in
   * logical px: a dot is under 20, a deliberate centimetre of line is around
   * 200. Low on purpose — the point is to stop an accident, not to demand a
   * drawing, and somebody who wants to add one small considered mark still
   * can.
   */
  minInk: 200,
  /** Screen speed (css px/ms) at which the pen reaches its thinnest. */
  speedRef: 1.7,
  /** Width multiplier at max speed / at rest. */
  minFactor: 0.55,
  maxFactor: 1.12,
  /** How fast width chases its target. Lower = smoother, more lag. */
  widthSmoothing: 0.28,
  /** How fast the drawn point chases the finger. Lower = smoother, more lag. */
  posSmoothing: 0.55,
  /** Minimum screen travel (css px) before a new point is recorded. */
  minStepCss: 0.7,
  /**
   * How far ahead of the last raw sample the visible tip is drawn, in ms of
   * travel at the current speed. Display only — never recorded — so a bad
   * guess lasts one frame and leaves nothing behind. This is the difference
   * between ink that follows the finger and ink that chases it. 0 disables.
   */
  predictMs: 26,
  /** Ceiling on that extrapolation, in logical px, so a flick can't overshoot. */
  predictMaxPx: 70,
  /** Entry/exit taper length, as a multiple of the pen's base width. */
  taper: 1.0,
  /** Width multiplier at the very tip of a tapered stroke. */
  taperFloor: 0.5,
  /** Width multiplier at zero stylus pressure. */
  pressureFloor: 0.35,
}

export type Tuning = typeof DEFAULT_TUNING

const params = new URLSearchParams(
  typeof location === 'undefined' ? '' : location.search,
)

function num(key: string, fallback: number): number {
  const raw = params.get(key)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export const TUNING: Tuning = {
  inkBudget: num('ink', DEFAULT_TUNING.inkBudget),
  minInk: num('minInk', DEFAULT_TUNING.minInk),
  speedRef: num('speedRef', DEFAULT_TUNING.speedRef),
  minFactor: num('minFactor', DEFAULT_TUNING.minFactor),
  maxFactor: num('maxFactor', DEFAULT_TUNING.maxFactor),
  widthSmoothing: num('widthSmoothing', DEFAULT_TUNING.widthSmoothing),
  posSmoothing: num('posSmoothing', DEFAULT_TUNING.posSmoothing),
  minStepCss: num('minStepCss', DEFAULT_TUNING.minStepCss),
  predictMs: num('predictMs', DEFAULT_TUNING.predictMs),
  predictMaxPx: num('predictMaxPx', DEFAULT_TUNING.predictMaxPx),
  taper: num('taper', DEFAULT_TUNING.taper),
  taperFloor: num('taperFloor', DEFAULT_TUNING.taperFloor),
  pressureFloor: num('pressureFloor', DEFAULT_TUNING.pressureFloor),
}

export const SHOW_TUNER = params.get('tune') === '1'

/** Signature pad is the same engine at a different size and a fixed pen. */
export const SIGNATURE_W = 900
export const SIGNATURE_H = 340
/**
 * Ink for a signature, raised from 1600 after playtesting.
 *
 * The sheet is 900x340 and the pen is fixed-width, so a name written at a
 * comfortable size costs more than the first guess allowed — people were
 * running dry partway through their own name, which is a bad first thirty
 * seconds in a product whose whole identity is that mark.
 */
export const SIGNATURE_INK = 3200
export const SIGNATURE_WIDTH = 6
export const SIGNATURE_COLOR = '#1B1A17'
