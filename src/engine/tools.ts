import type { Stroke } from './types'
import { PAPER } from '../config'

/**
 * The tools.
 *
 * Every one of them produces ordinary `Stroke`s in the format the ledger has
 * stored since milestone 2. That is not a coincidence or a convenience — it is
 * the design constraint the whole set was chosen against. A tool that needed a
 * new kind of row would need a new renderer, a new codec path, a new video
 * path, a new print path, and would divide the archive into things that
 * replay and things that used to.
 *
 * The rule every one of them keeps: **none of them can touch another layer's
 * pixels.** Stamps and texture pens only add marks. A wash multiplies at a low
 * fixed strength over what is beneath and is refused a dark colour. A fill is
 * bounded by what is already on the sheet and is stored as its own geometry.
 * Nothing here has a code path that removes anything, and there is no eraser
 * hiding in any of them.
 */

// ------------------------------------------------------------------- stamps

/** A stamp is a set of paths in a 100×100 box, drawn from its own centre. */
export interface Stamp {
  id: string
  name: string
  /** Each path is a flat [x, y, x, y, …] list in stamp space. */
  paths: number[][]
  /** Whether a path should be closed back to its first point. */
  closed?: boolean
}

const arc = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n = 16,
): number[] => {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  }
  return out
}

/**
 * Deliberately small, and deliberately not cute.
 *
 * This is the biggest inclusivity lever in the product: somebody who says they
 * cannot draw still puts down something that reads as intentional, and the
 * canvas gets a bird rather than an apology. So they are line drawings in the
 * same weight as the pen — things that sit inside somebody else's picture
 * without announcing that a menu was involved.
 */
export const STAMPS: Stamp[] = [
  {
    id: 'bird',
    name: 'Bird',
    paths: [arc(28, 50, 24, 15, Math.PI * 0.15, Math.PI * 0.85),
            arc(72, 50, 24, 15, Math.PI * 0.15, Math.PI * 0.85)],
  },
  {
    id: 'leaf',
    name: 'Leaf',
    paths: [
      [...arc(50, 50, 26, 40, -Math.PI / 2, Math.PI / 2, 14),
       ...arc(50, 50, 26, 40, Math.PI / 2, Math.PI * 1.5, 14)],
      [50, 12, 50, 88],
    ],
  },
  {
    id: 'star',
    name: 'Star',
    paths: [
      Array.from({ length: 11 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 === 0 ? 38 : 16
        return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r]
      }).flat(),
    ],
  },
  {
    id: 'window',
    name: 'Window',
    paths: [
      [22, 18, 78, 18, 78, 84, 22, 84, 22, 18],
      [50, 18, 50, 84],
      [22, 51, 78, 51],
    ],
  },
  {
    id: 'roof',
    name: 'House',
    paths: [
      [20, 88, 20, 46, 50, 20, 80, 46, 80, 88, 20, 88],
      [42, 88, 42, 62, 58, 62, 58, 88],
    ],
  },
  {
    id: 'boat',
    name: 'Boat',
    paths: [
      [18, 66, 30, 82, 70, 82, 82, 66],
      [50, 66, 50, 16],
      [50, 20, 74, 62, 50, 62],
    ],
  },
  {
    id: 'moon',
    name: 'Moon',
    paths: [
      [...arc(50, 50, 34, 34, Math.PI * 0.35, Math.PI * 1.65, 22),
       ...arc(38, 50, 30, 34, Math.PI * 1.65, Math.PI * 0.35, 18).reverse()],
    ],
  },
  {
    id: 'wave',
    name: 'Wave',
    paths: [
      Array.from({ length: 33 }, (_, i) => {
        const x = 8 + i * 2.6
        return [x, 50 + Math.sin((i / 32) * Math.PI * 3) * 16]
      }).flat(),
      Array.from({ length: 33 }, (_, i) => {
        const x = 8 + i * 2.6
        return [x, 74 + Math.sin((i / 32) * Math.PI * 3 + 0.7) * 10]
      }).flat(),
    ],
  },
]

/**
 * Places a stamp and hands back the strokes it becomes.
 *
 * Its ink is its outline length, exactly as if it had been drawn by hand,
 * which is the only pricing that keeps a stamp from being cheaper than
 * drawing. Slight rotation so a row of them never reads as a repeated tile.
 */
export function stampStrokes(
  stamp: Stamp,
  x: number,
  y: number,
  size: number,
  color: string,
  width: number,
  t0: number,
  rotation = 0,
): Stroke[] {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const k = size / 100

  return stamp.paths.map((path, pi) => {
    const pts = []
    let ink = 0
    let px = 0
    let py = 0
    for (let i = 0; i + 1 < path.length; i += 2) {
      const ox = (path[i] - 50) * k
      const oy = (path[i + 1] - 50) * k
      const gx = x + ox * cos - oy * sin
      const gy = y + ox * sin + oy * cos
      if (i > 0) ink += Math.hypot(gx - px, gy - py)
      px = gx
      py = gy
      pts.push({
        x: Math.round(gx * 10) / 10,
        y: Math.round(gy * 10) / 10,
        w: width,
        t: pi * 40 + (i / 2) * 8,
      })
    }
    return { color, size: 1, t0, ink, pts }
  })
}

// ------------------------------------------------------------------ texture

export type Texture = 'hatch' | 'stipple' | 'halftone'

/**
 * Depth without skill, and the reason it is priced the way it is.
 *
 * A texture pen lays down many small marks rather than one line, so charging
 * only for travelled distance would make it the cheapest ink in the product
 * and every canvas would end up a field of dots. Each mark therefore costs at
 * least `MARK_FLOOR`, which the ledger charges too — `layer_ink()` applies the
 * same floor, so the client and the server agree about what a stipple costs
 * and neither has to trust the other.
 *
 * The floor also does something quieter: it caps how many marks fit inside a
 * turn's budget at comfortably under the six-hundred-stroke ceiling the ledger
 * enforces, so a texture layer can never be refused for a reason the player
 * cannot see.
 */
export const MARK_FLOOR = 18

const rand = (seed: { n: number }) => {
  seed.n = (seed.n * 1664525 + 1013904223) >>> 0
  return seed.n / 4294967296
}

export function textureMarks(
  texture: Texture,
  x: number,
  y: number,
  angle: number,
  scale: number,
  color: string,
  t0: number,
  seed: { n: number },
): Stroke[] {
  const jitter = (m: number) => (rand(seed) - 0.5) * m

  if (texture === 'stipple' || texture === 'halftone') {
    const marks: Stroke[] = []
    const n = texture === 'halftone' ? 3 : 2
    for (let i = 0; i < n; i++) {
      const r = texture === 'halftone' ? scale * (0.3 + rand(seed) * 0.9) : scale * 0.45
      const px = x + jitter(scale * 3.2)
      const py = y + jitter(scale * 3.2)
      marks.push({
        color,
        size: 0,
        t0,
        ink: MARK_FLOOR,
        // A single sample is drawn as a dot of its own width, which is exactly
        // what a stipple is.
        pts: [{ x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10, w: r * 2, t: i * 6 }],
      })
    }
    return marks
  }

  // Hatch: a short tick across the direction of travel, so a dragged stroke
  // reads as shading rather than as a fence.
  const len = scale * 3 + jitter(scale)
  const a = angle + Math.PI / 2 + jitter(0.35)
  const dx = (Math.cos(a) * len) / 2
  const dy = (Math.sin(a) * len) / 2
  const w = Math.max(0.8, scale * 0.5)
  return [
    {
      color,
      size: 0,
      t0,
      ink: Math.max(MARK_FLOOR, len),
      pts: [
        { x: Math.round((x - dx) * 10) / 10, y: Math.round((y - dy) * 10) / 10, w, t: 0 },
        { x: Math.round((x + dx) * 10) / 10, y: Math.round((y + dy) * 10) / 10, w, t: 8 },
      ],
    },
  ]
}

// --------------------------------------------------------------- bounded fill

/**
 * Colour inside what somebody else outlined.
 *
 * The purest response act available: it cannot be done alone, it cannot be
 * done first, and what it produces depends entirely on what the people before
 * you left. It is also the most expensive thing in the box, priced by the area
 * it covers, because a tool that fills a third of the sheet for the cost of a
 * line would end the canvas.
 *
 * How it works, and why it is not a flood fill stored as a seed point: the
 * region is flooded once, here, against a raster of what is currently on the
 * sheet, and then its boundary is traced and stored as a polygon. Storing the
 * seed and re-flooding at render time is smaller and completely wrong — two
 * browsers antialias a curve differently by one pixel, a flood escapes through
 * that pixel on one of them, and the archive stops being the same picture
 * everywhere it is opened.
 */
export interface FillResult {
  stroke: Stroke | null
  /** Fraction of the sheet covered — what the fill is charged on. */
  coverage: number
  reason?: 'escaped' | 'tiny'
}

/** Resolution the mask is computed at. Lower is faster and coarser; this is
 *  about one screen of a phone, which is the scale a person is judging by. */
const MASK = 512

export function traceFill(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  lx: number,
  ly: number,
  color: string,
  t0: number,
  opts: { maxCoverage?: number } = {},
): FillResult {
  const maxCoverage = opts.maxCoverage ?? 0.34

  const w = MASK
  const h = Math.max(1, Math.round((MASK * height) / width))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data

  // "Bare paper" rather than "the colour under the tap": a fill spreads across
  // everything nobody has drawn on, and stops at any mark at all, whoever made
  // it. That is what makes it a response to the whole sheet rather than to one
  // person's line.
  const paper = hexToRgb(PAPER)
  const isOpen = (i: number) =>
    Math.abs(px[i] - paper[0]) + Math.abs(px[i + 1] - paper[1]) + Math.abs(px[i + 2] - paper[2]) < 42

  const sx = Math.floor((lx / width) * w)
  const sy = Math.floor((ly / height) * h)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { stroke: null, coverage: 0, reason: 'tiny' }
  if (!isOpen((sy * w + sx) * 4)) return { stroke: null, coverage: 0, reason: 'tiny' }

  const inside = new Uint8Array(w * h)
  const stack = [sy * w + sx]
  inside[stack[0]] = 1
  let filled = 0
  let touchedEdge = false

  while (stack.length) {
    const p = stack.pop()!
    filled++
    const x = p % w
    const y = (p / w) | 0
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchedEdge = true

    if (x > 0 && !inside[p - 1] && isOpen((p - 1) * 4)) { inside[p - 1] = 1; stack.push(p - 1) }
    if (x < w - 1 && !inside[p + 1] && isOpen((p + 1) * 4)) { inside[p + 1] = 1; stack.push(p + 1) }
    if (y > 0 && !inside[p - w] && isOpen((p - w) * 4)) { inside[p - w] = 1; stack.push(p - w) }
    if (y < h - 1 && !inside[p + w] && isOpen((p + w) * 4)) { inside[p + w] = 1; stack.push(p + w) }
  }

  const coverage = filled / (w * h)

  // Somebody tapping bare paper away from any outline would otherwise flood
  // the whole sheet. Refusing is better than doing it: an unbounded fill is
  // the one shape this tool has that reads as painting over everyone.
  if (touchedEdge || coverage > maxCoverage) {
    return { stroke: null, coverage, reason: 'escaped' }
  }
  if (filled < 24) return { stroke: null, coverage, reason: 'tiny' }

  const contours = traceContours(inside, w, h)
  if (contours.length === 0) return { stroke: null, coverage, reason: 'tiny' }

  const kx = width / w
  const ky = height / h
  const pts: Stroke['pts'] = []
  contours.forEach((ring, ci) => {
    if (ci > 0) {
      // A zero-width sample separates one contour from the next; the renderer
      // reads it as "close this ring and begin another".
      pts.push({ x: 0, y: 0, w: 0, t: 0 })
    }
    for (const [x, y] of simplify(ring, 1.1)) {
      pts.push({
        x: Math.round(x * kx * 10) / 10,
        y: Math.round(y * ky * 10) / 10,
        w: 1,
        t: 0,
      })
    }
  })

  return {
    stroke: {
      color,
      size: 2,
      t0,
      // Priced by area, in the same units as everything else: the length of
      // line it would have taken to hatch the region solidly.
      ink: Math.round(coverage * width * height * 0.02),
      pts,
      mode: 'f',
    },
    coverage,
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/**
 * Moore-neighbour boundary tracing, outer contour and holes.
 *
 * Walks the edge of the mask keeping the filled region on one side. Enough for
 * regions of the shape people actually outline, and it degrades into a coarse
 * polygon rather than into nonsense when they are not.
 */
function traceContours(mask: Uint8Array, w: number, h: number): [number, number][][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x])
  const seen = new Uint8Array(w * h)
  const contours: [number, number][][] = []
  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1],
  ]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y) || seen[y * w + x]) continue
      // A boundary pixel: filled, with something not filled beside it.
      if (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1)) continue

      const ring: [number, number][] = []
      let cx = x
      let cy = y
      let dir = 0
      const startX = x
      const startY = y
      let steps = 0

      do {
        ring.push([cx, cy])
        seen[cy * w + cx] = 1
        let moved = false
        for (let k = 0; k < 8; k++) {
          const d = (dir + 6 + k) % 8
          const nx = cx + dirs[d][0]
          const ny = cy + dirs[d][1]
          if (at(nx, ny)) {
            cx = nx
            cy = ny
            dir = d
            moved = true
            break
          }
        }
        if (!moved) break
        steps++
      } while ((cx !== startX || cy !== startY) && steps < w * h)

      if (ring.length > 8) contours.push(ring)
      // One outer ring plus a couple of holes is plenty; a region that traces
      // into dozens is noise, and storing it would cost more than it says.
      if (contours.length >= 3) return contours
    }
  }
  return contours
}

/** Douglas–Peucker. A traced ring is one point per pixel; this gets a typical
 *  region down to a couple of hundred without a visible corner. */
function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length < 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]

  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = 0
    let idx = -1
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (d > worst) {
        worst = d
        idx = i
      }
    }
    if (idx > 0 && worst > tolerance) {
      keep[idx] = 1
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}
