/**
 * A recorded sample along a stroke. Width is baked in at capture time rather
 * than re-derived on replay, so a timelapse rendered on a server three years
 * from now is pixel-identical to what the artist saw in their hand.
 *
 *   x, y — logical canvas coordinates
 *   w    — line width in logical px at this sample
 *   t    — ms since the stroke began
 */
export interface Pt {
  x: number
  y: number
  w: number
  t: number
}

export interface Stroke {
  /** Hex from the master palette. */
  color: string
  /** Index into PEN_WIDTHS. Kept for analytics and palette-inheritance work. */
  size: number
  /** ms since the turn began, for the timelapse. */
  t0: number
  /** Logical px of travel this stroke consumed from the ink budget. */
  ink: number
  pts: Pt[]
}

/** One player's contribution. Append-only; never edited, never deleted. */
export type Layer = Stroke[]

/** Maps logical canvas coordinates to css px within the viewport. */
export interface View {
  scale: number
  tx: number
  ty: number
}

export const toLogical = (v: View, cx: number, cy: number) => ({
  x: (cx - v.tx) / v.scale,
  y: (cy - v.ty) / v.scale,
})
