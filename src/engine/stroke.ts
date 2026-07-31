import type { Pt, Stroke } from './types'
import type { Tuning } from '../config'

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100

export interface BuilderInput {
  /** Logical canvas coordinates. */
  lx: number
  ly: number
  /** Screen coordinates, css px. Velocity is measured here so that the taper
   *  feels identical whether you are zoomed out to fit or zoomed in to 4x. */
  cx: number
  cy: number
  pressure: number
  pointerType: string
  t: number
}

/**
 * Accumulates one stroke from a pointer gesture.
 *
 * Three things are happening at once and they are easy to confuse:
 *   1. Position smoothing (EMA) — kills finger jitter, costs a little lag.
 *      The true final position is snapped back on finish() so the line always
 *      ends exactly where you lifted.
 *   2. Width modulation — stylus pressure when it's real, screen velocity
 *      otherwise. Fast is thin.
 *   3. Ink accounting — measured along the smoothed path, in logical px. When
 *      the budget runs out mid-stroke the stroke is cut at the exact point the
 *      pen dries up rather than being rejected wholesale.
 */
export class StrokeBuilder {
  readonly stroke: Stroke
  ink = 0

  private base: number
  private tune: Tuning
  private inkLimit: number

  private started = false
  private sx = 0 // smoothed logical position
  private sy = 0
  private rawLx = 0 // last raw logical position
  private rawLy = 0
  private lastCx = 0
  private lastCy = 0
  private lastT = 0
  private t0 = 0
  private speed = 0
  private w = 0
  private travelled = 0

  constructor(
    color: string,
    sizeIndex: number,
    base: number,
    tune: Tuning,
    inkLimit: number,
    turnT0: number,
  ) {
    this.base = base
    this.tune = tune
    this.inkLimit = Math.max(0, inkLimit)
    this.stroke = { color, size: sizeIndex, t0: turnT0, ink: 0, pts: [] }
  }

  get points(): Pt[] {
    return this.stroke.pts
  }

  get exhausted(): boolean {
    return this.ink >= this.inkLimit - 1e-6
  }

  get elapsed(): number {
    return this.started ? this.lastT - this.t0 : 0
  }

  add(i: BuilderInput): void {
    if (this.exhausted) return

    if (!this.started) {
      this.started = true
      this.t0 = i.t
      this.sx = i.lx
      this.sy = i.ly
      this.rawLx = i.lx
      this.rawLy = i.ly
      this.lastCx = i.cx
      this.lastCy = i.cy
      this.lastT = i.t
      this.w = this.base * (this.tune.taper > 0 ? this.tune.taperFloor : 1)
      this.stroke.pts.push({ x: r1(i.lx), y: r1(i.ly), w: r2(this.w), t: 0 })
      return
    }

    this.rawLx = i.lx
    this.rawLy = i.ly

    const dcx = i.cx - this.lastCx
    const dcy = i.cy - this.lastCy
    const screenStep = Math.hypot(dcx, dcy)
    if (screenStep < this.tune.minStepCss) return

    const dt = Math.max(1, i.t - this.lastT)
    const v = screenStep / dt
    this.speed = this.speed === 0 ? v : this.speed + (v - this.speed) * 0.35

    // Chase the finger.
    const a = this.tune.posSmoothing
    let nx = this.sx + (i.lx - this.sx) * a
    let ny = this.sy + (i.ly - this.sy) * a
    let step = Math.hypot(nx - this.sx, ny - this.sy)
    if (step < 1e-6) {
      this.lastCx = i.cx
      this.lastCy = i.cy
      this.lastT = i.t
      return
    }

    // The pen runs out mid-stroke: cut it exactly where the ink ends.
    const remaining = this.inkLimit - this.ink
    if (step > remaining) {
      const k = remaining / step
      nx = this.sx + (nx - this.sx) * k
      ny = this.sy + (ny - this.sy) * k
      step = remaining
    }

    this.ink += step
    this.travelled += step

    this.w += (this.widthTarget(i) - this.w) * this.tune.widthSmoothing
    this.sx = nx
    this.sy = ny

    this.stroke.pts.push({
      x: r1(nx),
      y: r1(ny),
      w: r2(Math.max(0.2, this.w)),
      t: Math.round(i.t - this.t0),
    })

    this.lastCx = i.cx
    this.lastCy = i.cy
    this.lastT = i.t
  }

  private widthTarget(i: BuilderInput): number {
    let f: number
    // Chromium reports 0.5 for every mouse/touch contact; only trust a real
    // stylus, which reports a varying value.
    if (i.pointerType === 'pen' && i.pressure > 0 && i.pressure < 1) {
      f =
        this.tune.pressureFloor +
        (1 - this.tune.pressureFloor) * i.pressure * 1.1
    } else {
      const s = Math.min(1, this.speed / this.tune.speedRef)
      f = this.tune.maxFactor + (this.tune.minFactor - this.tune.maxFactor) * s
    }
    const taperLen = this.base * this.tune.taper
    if (taperLen > 0) {
      const r = Math.min(1, this.travelled / taperLen)
      f *= this.tune.taperFloor + (1 - this.tune.taperFloor) * r
    }
    return this.base * f
  }

  /** Closes the stroke. Returns null if nothing was actually drawn. */
  finish(): Stroke | null {
    const pts = this.stroke.pts
    if (pts.length === 0) return null

    // A tap is a dot at full width, not a tapered speck.
    if (pts.length === 1) {
      pts[0].w = r2(this.base)
      this.stroke.ink = this.ink
      return this.stroke
    }

    // Snap to where the finger actually lifted, so the line doesn't stop short.
    const tail = Math.hypot(this.rawLx - this.sx, this.rawLy - this.sy)
    const remaining = this.inkLimit - this.ink
    if (tail > 0.5 && remaining > 0) {
      const k = Math.min(1, remaining / tail)
      const fx = this.sx + (this.rawLx - this.sx) * k
      const fy = this.sy + (this.rawLy - this.sy) * k
      this.ink += tail * k
      pts.push({
        x: r1(fx),
        y: r1(fy),
        w: r2(Math.max(0.2, this.w)),
        t: Math.round(this.lastT - this.t0),
      })
    }

    this.applyExitTaper()
    this.stroke.ink = this.ink
    return this.stroke
  }

  private applyExitTaper(): void {
    const taperLen = this.base * this.tune.taper
    if (taperLen <= 0) return
    const pts = this.stroke.pts
    let d = 0
    for (let i = pts.length - 1; i >= 0; i--) {
      const r = Math.min(1, d / taperLen)
      const k = this.tune.taperFloor + (1 - this.tune.taperFloor) * r
      pts[i].w = r2(Math.max(0.2, pts[i].w * k))
      if (r >= 1) break
      if (i > 0) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
  }
}
