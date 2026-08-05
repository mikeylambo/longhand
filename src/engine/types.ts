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

/**
 * How a stroke is laid down.
 *
 * Absent means the pen, which is everything drawn before these existed and
 * everything drawn with a pen since. The other two are the tools that could
 * not be expressed as an ordinary line:
 *
 *   w  wash — multiplied over what is beneath at a fixed low alpha, so it
 *      tints a region without covering it. Restricted to light colours, and
 *      that restriction is enforced server-side: multiply with a dark enough
 *      colour, repeated, would amount to painting over somebody, and "nothing
 *      you add can remove anyone else's" has to survive contact with a tool
 *      that is technically additive.
 *   f  fill — the points are a closed polygon rather than a path. Traced on
 *      the client at the moment of the tap, from what was already on the
 *      sheet, and then stored as geometry. Storing the seed point instead and
 *      re-flooding at render time would have been smaller and is the reason
 *      this took a day: two browsers rasterise a curve differently by a pixel,
 *      the flood escapes through the gap on one of them, and the archive stops
 *      being the same picture everywhere. A polygon is a fact.
 *
 * Stamps and texture pens need nothing here. They emit ordinary strokes,
 * which is the whole reason they were cheap to build and cost the archive
 * nothing.
 */
export type StrokeMode = 'w' | 'f'

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
  /** Absent for a pen stroke, which is most of the archive. */
  mode?: StrokeMode
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
