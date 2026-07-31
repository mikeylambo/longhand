import type { Stroke } from './types'

/**
 * Wire format for the `layers.strokes` jsonb column. Objects-per-point is
 * roughly 4x the bytes of a flat array for identical information, and a full
 * ink budget is a few thousand points, so the flat form is what gets stored.
 * Milestone 2 reads and writes exactly this.
 */
export interface EncodedStroke {
  /** colour */
  c: string
  /** pen size index */
  s: number
  /** ms since the turn began */
  t: number
  /** ink consumed, logical px */
  i: number
  /** flat [x, y, w, dt, ...] */
  p: number[]
}

export interface EncodedLayer {
  v: 1
  w: number
  h: number
  strokes: EncodedStroke[]
}

export function encodeLayer(
  strokes: Stroke[],
  width: number,
  height: number,
): EncodedLayer {
  return {
    v: 1,
    w: width,
    h: height,
    strokes: strokes.map((s) => {
      const p: number[] = []
      for (const pt of s.pts) p.push(pt.x, pt.y, pt.w, pt.t)
      return { c: s.color, s: s.size, t: s.t0, i: Math.round(s.ink), p }
    }),
  }
}

export function decodeLayer(enc: EncodedLayer): Stroke[] {
  return enc.strokes.map((e) => {
    const pts = []
    for (let i = 0; i + 3 < e.p.length; i += 4) {
      pts.push({ x: e.p[i], y: e.p[i + 1], w: e.p[i + 2], t: e.p[i + 3] })
    }
    return { color: e.c, size: e.s, t0: e.t, ink: e.i, pts }
  })
}

export function countPoints(strokes: Stroke[]): number {
  let n = 0
  for (const s of strokes) n += s.pts.length
  return n
}
