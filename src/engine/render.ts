import type { Stroke, View } from './types'
// Extension on purpose: this module is pulled into the Node-ESM serverless
// render in api/og.ts, where an extensionless relative import throws at
// runtime. Harmless everywhere else — Vite and tsc resolve it the same.
import { PAPER } from '../config.js'

/**
 * Sets the context up so all drawing happens in logical canvas coordinates —
 * line widths included, which is what keeps a 3.5px pen looking like a 3.5px
 * pen at every zoom level.
 */
export function applyView(
  ctx: CanvasRenderingContext2D,
  view: View,
  dpr: number,
): void {
  ctx.setTransform(
    dpr * view.scale,
    0,
    0,
    dpr * view.scale,
    dpr * view.tx,
    dpr * view.ty,
  )
}

/**
 * How much of what is beneath a wash still shows through.
 *
 * Low on purpose. A multiply at full strength is a way of painting somebody
 * out while technically only ever adding, and the promise that nothing you add
 * can remove anyone else's work has to hold against a tool as well as against
 * a code path. At this strength a wash tints a region and the drawing under it
 * stays legible however many times it is washed.
 */
export const WASH_ALPHA = 0.28

/**
 * A fill is a closed polygon, traced from the sheet at the moment it was
 * placed. Drawing it is therefore ordinary — the interesting part happened
 * once, on somebody's phone, and what survives into the archive is geometry
 * rather than an instruction to re-derive geometry.
 *
 * `evenodd` so that a region traced with holes in it keeps its holes: fill the
 * space inside a face and the eyes stay eyes.
 */
function drawFill(ctx: CanvasRenderingContext2D, s: Stroke): void {
  if (s.pts.length < 3) return
  ctx.save()
  ctx.globalAlpha = WASH_ALPHA * 2.4
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = s.color
  ctx.beginPath()
  ctx.moveTo(s.pts[0].x, s.pts[0].y)
  for (let i = 1; i < s.pts.length; i++) {
    // A zero-width sample is the break between one contour and the next: the
    // outside of the shape, then each hole.
    if (s.pts[i].w === 0) {
      ctx.closePath()
      const next = s.pts[i + 1]
      if (!next) break
      ctx.moveTo(next.x, next.y)
      i++
      continue
    }
    ctx.lineTo(s.pts[i].x, s.pts[i].y)
  }
  ctx.closePath()
  ctx.fill('evenodd')
  ctx.restore()
}

/**
 * Draws samples [from, to) of a stroke, whichever tool made it.
 *
 * The three modes diverge here and nowhere else, which is what keeps the
 * timelapse, the video, the export and the live surface unable to disagree
 * about what a layer looks like.
 */
export function drawSegments(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  from: number,
  to: number,
): void {
  const p = s.pts
  const n = p.length
  if (n === 0) return

  if (s.mode === 'f') {
    // A polygon is one thing or nothing; there is no partial fill, so it lands
    // whole the first time the walk reaches it. That keeps the timelapse
    // honest — a fill appears the moment it was made.
    if (from <= 0) drawFill(ctx, s)
    return
  }

  if (s.mode === 'w') {
    ctx.save()
    ctx.globalAlpha = WASH_ALPHA
    ctx.globalCompositeOperation = 'multiply'
    drawPath(ctx, s, from, to)
    ctx.restore()
    return
  }

  drawPath(ctx, s, from, to)
}

/**
 * Segment `i` runs from the midpoint of (p[i-1], p[i]) through p[i] to the
 * midpoint of (p[i], p[i+1]) as a quadratic, at p[i]'s width. Midpoint
 * quadratics give a C1-continuous curve while letting every sample carry its
 * own width; round caps and joins hide the width discontinuity at the seams.
 *
 * A segment is final — it will never need redrawing — once p[i+1] exists.
 * That is what makes the live layer append-only, and therefore cheap.
 */
function drawPath(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  from: number,
  to: number,
): void {
  const p = s.pts
  const n = p.length

  ctx.strokeStyle = s.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  if (n === 1) {
    if (from <= 0) {
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(p[0].x, p[0].y, Math.max(0.1, p[0].w / 2), 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  const start = Math.max(0, from)
  const end = Math.min(to, n)
  for (let i = start; i < end; i++) {
    const b = p[i]
    const a = i > 0 ? p[i - 1] : null
    const c = i < n - 1 ? p[i + 1] : null
    const sx = a ? (a.x + b.x) / 2 : b.x
    const sy = a ? (a.y + b.y) / 2 : b.y
    const ex = c ? (b.x + c.x) / 2 : b.x
    const ey = c ? (b.y + c.y) / 2 : b.y

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    if (a && c) ctx.quadraticCurveTo(b.x, b.y, ex, ey)
    else ctx.lineTo(ex, ey)
    ctx.lineWidth = Math.max(0.2, b.w)
    ctx.stroke()
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  drawSegments(ctx, s, 0, s.pts.length)
}

export function drawLayers(
  ctx: CanvasRenderingContext2D,
  layers: Stroke[][],
): void {
  for (const layer of layers) for (const s of layer) drawStroke(ctx, s)
}

/**
 * Flat render used by the review screen, the shareable "your layer" card, and
 * eventually the server-side snapshot. Same code path as the live surface, so
 * what you export is what you drew.
 */
export function renderLayers(
  width: number,
  height: number,
  layers: Stroke[][],
  opts: { scale?: number; paper?: string | null } = {},
): HTMLCanvasElement {
  const scale = opts.scale ?? 1
  const paper = opts.paper === undefined ? PAPER : opts.paper
  const cv = document.createElement('canvas')
  cv.width = Math.round(width * scale)
  cv.height = Math.round(height * scale)
  const ctx = cv.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  if (paper) {
    ctx.fillStyle = paper
    ctx.fillRect(0, 0, width, height)
  }
  drawLayers(ctx, layers)
  return cv
}
