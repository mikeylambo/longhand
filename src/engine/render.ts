import type { Stroke, View } from './types'
import { PAPER } from '../config'

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
 * Segment `i` runs from the midpoint of (p[i-1], p[i]) through p[i] to the
 * midpoint of (p[i], p[i+1]) as a quadratic, at p[i]'s width. Midpoint
 * quadratics give a C1-continuous curve while letting every sample carry its
 * own width; round caps and joins hide the width discontinuity at the seams.
 *
 * A segment is final — it will never need redrawing — once p[i+1] exists.
 * That is what makes the live layer append-only, and therefore cheap.
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
