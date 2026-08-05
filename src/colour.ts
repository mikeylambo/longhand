/**
 * Colour maths for the palette.
 *
 * The rules here mirror `colour_allowed()` in the database exactly, because the
 * server is the one that decides and a UI that offers something the server
 * refuses is worse than no UI at all.
 */

/** The palette's own tonal range, measured from the sixteen: hue is free, these
 *  are not. Keep in step with `colour_in_gamut()` in migration 0012. */
export const GAMUT = { minS: 18, maxS: 72, minL: 28, maxL: 72 }

export interface Hsl {
  h: number
  s: number
  l: number
}

export function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  let h = 0
  let s = 0
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

const byte = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n * 255)))
    .toString(16)
    .padStart(2, '0')

export function hslToHex({ h, s, l }: Hsl): string {
  const S = s / 100
  const L = l / 100
  if (S === 0) {
    const v = byte(L)
    return `#${v}${v}${v}`.toUpperCase()
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S
  const p = 2 * L - q
  const f = (t: number) => {
    let x = (t + 1) % 1
    if (x < 0) x += 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  const hh = h / 360
  return `#${byte(f(hh + 1 / 3))}${byte(f(hh))}${byte(f(hh - 1 / 3))}`.toUpperCase()
}

/** Any hue, held to the palette's light. */
export function clampToGamut(hue: number): string {
  const mid = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return hslToHex({
    h: ((hue % 360) + 360) % 360,
    s: mid(52, GAMUT.minS, GAMUT.maxS),
    l: mid(46, GAMUT.minL, GAMUT.maxL),
  })
}

export function inGamut(hex: string): boolean {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return false
  const { s, l } = hexToHsl(hex)
  return s >= GAMUT.minS && s <= GAMUT.maxS && l >= GAMUT.minL && l <= GAMUT.maxL
}

/**
 * The five of a family, darkest to lightest, exactly as generated into
 * `palette_colors`. Duplicated here so the fan-out can be drawn without a round
 * trip; the server still has the final say.
 */
const STEPS: Array<{ l: (l: number) => number; s: (s: number) => number }> = [
  { l: (l) => clamp(l * 0.5, 5, 95), s: (s) => clamp(s * 1.05, 0, 85) },
  { l: (l) => clamp(l * 0.74, 5, 95), s: (s) => clamp(s * 1.02, 0, 85) },
  { l: (l) => l, s: (s) => s },
  { l: (l) => clamp(l + (100 - l) * 0.3, 5, 95), s: (s) => s * 0.9 },
  { l: (l) => clamp(l + (100 - l) * 0.56, 5, 95), s: (s) => s * 0.78 },
]

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function family(hex: string): string[] {
  const base = hexToHsl(hex)
  return STEPS.map((st) =>
    st.l(base.l) === base.l && st.s(base.s) === base.s
      ? hex.toUpperCase()
      : hslToHex({ h: base.h, s: st.s(base.s), l: st.l(base.l) }),
  )
}

/** Enough contrast to draw a selection ring that stays visible on the swatch. */
export function contrastInk(hex: string): string {
  return hexToHsl(hex).l > 62 ? '#1B1A17' : '#FBF8F1'
}

/**
 * Whether a colour is light enough to wash with.
 *
 * A multiply never removes a pixel, which is what makes a wash additive, and a
 * dark enough one repeated over somebody's work leaves a rectangle where their
 * drawing was — which is removal by another name. So a wash is held to the
 * lighter half of the range.
 *
 * `wash_colour_allowed()` in migration 0027 carries the same number. The UI
 * must never offer a colour the ledger will refuse after the drawing is
 * finished, which is the same reason `inGamut` exists.
 */
export const WASH_MIN_L = 46

export function washAllowed(hex: string): boolean {
  return hexToHsl(hex).l >= WASH_MIN_L
}
