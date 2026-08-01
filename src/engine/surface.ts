import type { Stroke, View } from './types'
import { StrokeBuilder } from './stroke'
import { applyView, drawLayers, drawSegments, drawStroke } from './render'
import { PAPER, PEN_WIDTHS, type Tuning } from '../config'

/** The wall around the sheet. Slightly darker than paper so it reads as paper. */
export const SURROUND = '#D7CFBE'

export interface SurfaceOptions {
  width: number
  height: number
  tuning: Tuning
  inkBudget: number
  /** Fixed pen for the signature pad; omit for the full palette surface. */
  fixedColor?: string
  fixedWidth?: number
  /** Signature pad is one small sheet — no reason to pinch it. */
  allowGestures?: boolean
  /** Fraction of the viewport the sheet occupies when fitted. */
  fitPad?: number
  onInk?: (used: number, budget: number) => void
  onStrokes?: (count: number) => void
  onZoom?: (scale: number, fitScale: number) => void
}

interface GestureState {
  a: number
  b: number
  dist0: number
  midX0: number
  midY0: number
  view0: View
}

const dist = (ax: number, ay: number, bx: number, by: number) =>
  Math.hypot(bx - ax, by - ay)

export class Surface {
  readonly el: HTMLCanvasElement

  private host: HTMLElement
  private opts: SurfaceOptions
  private dctx: CanvasRenderingContext2D

  /** Paper + every layer submitted before this turn. */
  private baseCv = document.createElement('canvas')
  private bctx: CanvasRenderingContext2D
  /** This turn's strokes only. Append-only; the reason drawing stays cheap. */
  private turnCv = document.createElement('canvas')
  private tctx: CanvasRenderingContext2D

  private dpr = 1
  private cssW = 0
  private cssH = 0
  private rect = { left: 0, top: 0 }

  private view: View = { scale: 1, tx: 0, ty: 0 }
  /** The view baseCv/turnCv were rendered at. Differs from `view` mid-pinch. */
  private cachedView: View = { scale: 1, tx: 0, ty: 0 }
  private fitScale = 1
  private dirty = true
  private fitted = false

  private priorLayers: Stroke[][] = []
  private turnStrokes: Stroke[] = []

  private color: string
  private sizeIndex = 1
  private turnStart = performance.now()

  private pointers = new Map<number, { x: number; y: number }>()
  private penSeen = false
  private drawing: { id: number; builder: StrokeBuilder } | null = null
  private liveDrawn = 0
  private gesture: GestureState | null = null

  private raf = 0
  private ro: ResizeObserver
  private destroyed = false
  private locked = false

  constructor(host: HTMLElement, opts: SurfaceOptions) {
    this.host = host
    this.opts = opts
    this.color = opts.fixedColor ?? '#1B1A17'

    this.el = document.createElement('canvas')
    this.el.className = 'lh-surface'
    host.appendChild(this.el)

    this.dctx = this.el.getContext('2d', { alpha: false })!
    this.bctx = this.baseCv.getContext('2d')!
    this.tctx = this.turnCv.getContext('2d')!

    this.el.addEventListener('pointerdown', this.onDown)
    this.el.addEventListener('pointermove', this.onMove)
    this.el.addEventListener('pointerup', this.onUp)
    this.el.addEventListener('pointercancel', this.onUp)
    this.el.addEventListener('wheel', this.onWheel, { passive: false })
    this.el.addEventListener('contextmenu', this.onContextMenu)

    // Handle for hand-feel tuning from the console during playtests.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__lh = this

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onUp)
    this.el.removeEventListener('wheel', this.onWheel)
    this.el.removeEventListener('contextmenu', this.onContextMenu)
    this.el.remove()
  }

  // ---------------------------------------------------------------- public

  setColor(hex: string): void {
    this.color = hex
  }

  setSizeIndex(i: number): void {
    this.sizeIndex = Math.max(0, Math.min(PEN_WIDTHS.length - 1, i))
  }

  /**
   * Stops the surface accepting new strokes. Used when the turn clock runs
   * out: the sheet stays visible, the pen just stops working.
   */
  setLocked(locked: boolean): void {
    this.locked = locked
    if (locked) this.abortStroke()
  }

  /** Live retune from the ?tune=1 panel, mid-session, without a reload. */
  setTuning(t: Tuning): void {
    this.opts.tuning = t
  }

  setInkBudget(n: number): void {
    this.opts.inkBudget = n
    this.report()
  }

  setPriorLayers(layers: Stroke[][]): void {
    this.priorLayers = layers
    this.invalidate(true)
  }

  getLayer(): Stroke[] {
    return this.turnStrokes
  }

  get inkUsed(): number {
    let n = 0
    for (const s of this.turnStrokes) n += s.ink
    return n + (this.drawing?.builder.ink ?? 0)
  }

  get strokeCount(): number {
    return this.turnStrokes.length
  }

  get isEmpty(): boolean {
    return this.turnStrokes.length === 0 && this.drawing === null
  }

  undo(): void {
    if (this.drawing || this.turnStrokes.length === 0) return
    this.turnStrokes.pop()
    this.rebuildTurn()
    this.report()
    this.invalidate()
  }

  clearTurn(): void {
    this.abortStroke()
    this.turnStrokes = []
    this.turnStart = performance.now()
    this.rebuildTurn()
    this.report()
    this.invalidate()
  }

  fit(animate = false): void {
    void animate
    const s = this.computeFitScale()
    this.view = {
      scale: s,
      tx: (this.cssW - this.opts.width * s) / 2,
      ty: (this.cssH - this.opts.height * s) / 2,
    }
    this.opts.onZoom?.(this.view.scale, this.fitScale)
    this.invalidate(true)
  }

  get zoom(): number {
    return this.view.scale
  }

  // ---------------------------------------------------------------- layout

  private computeFitScale(): number {
    const pad = this.opts.fitPad ?? 0.94
    this.fitScale = Math.min(
      (this.cssW * pad) / this.opts.width,
      (this.cssH * pad) / this.opts.height,
    )
    return this.fitScale
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    this.rect = { left: r.left, top: r.top }
    this.dpr = Math.min(window.devicePixelRatio || 1, 3)
    this.cssW = r.width
    this.cssH = r.height

    for (const cv of [this.el, this.baseCv, this.turnCv]) {
      cv.width = Math.round(this.cssW * this.dpr)
      cv.height = Math.round(this.cssH * this.dpr)
    }
    this.el.style.width = `${this.cssW}px`
    this.el.style.height = `${this.cssH}px`

    this.computeFitScale()
    if (!this.fitted) {
      this.fitted = true
      this.fit()
    } else {
      this.view.scale = Math.max(this.view.scale, this.fitScale)
      this.clampView()
      this.invalidate(true)
    }
  }

  private get maxScale(): number {
    return Math.max(this.fitScale * 8, 2)
  }

  private clampView(): void {
    const w = this.opts.width * this.view.scale
    const h = this.opts.height * this.view.scale
    this.view.tx =
      w <= this.cssW
        ? (this.cssW - w) / 2
        : Math.min(0, Math.max(this.cssW - w, this.view.tx))
    this.view.ty =
      h <= this.cssH
        ? (this.cssH - h) / 2
        : Math.min(0, Math.max(this.cssH - h, this.view.ty))
  }

  // ---------------------------------------------------------------- render

  private invalidate(rebuild = false): void {
    if (rebuild) this.dirty = true
    if (this.raf || this.destroyed) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.frame()
    })
  }

  private frame(): void {
    // Rebuilding mid-stroke is safe and necessary: a resize (phone rotating,
    // mobile url bar collapsing) clears the cached layers, and refusing to
    // rebuild until the finger lifts would blank the artwork underneath the
    // stroke in progress. rebuildTurn() resets liveDrawn, so flushLive simply
    // re-commits the finalised part of the live stroke at the new view.
    // Only a pinch defers, because the transformed blit covers it.
    if (this.dirty && !this.gesture) this.rebuild()
    this.paint()
  }

  /**
   * Everything is drawn inside the sheet. Ink that strays past the edge is
   * clipped here exactly as it will be clipped by the server-side snapshot and
   * the timelapse, so the surface never shows a player a mark that won't
   * survive into the archive.
   */
  private clipped(
    ctx: CanvasRenderingContext2D,
    view: View,
    fn: (ctx: CanvasRenderingContext2D) => void,
  ): void {
    ctx.save()
    applyView(ctx, view, this.dpr)
    ctx.beginPath()
    ctx.rect(0, 0, this.opts.width, this.opts.height)
    ctx.clip()
    fn(ctx)
    ctx.restore()
  }

  private rebuild(): void {
    this.dirty = false
    this.cachedView = { ...this.view }

    this.bctx.setTransform(1, 0, 0, 1, 0, 0)
    this.bctx.clearRect(0, 0, this.baseCv.width, this.baseCv.height)
    this.clipped(this.bctx, this.cachedView, (ctx) => {
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, this.opts.width, this.opts.height)
      drawLayers(ctx, this.priorLayers)
    })

    this.rebuildTurn()
  }

  private rebuildTurn(): void {
    this.tctx.setTransform(1, 0, 0, 1, 0, 0)
    this.tctx.clearRect(0, 0, this.turnCv.width, this.turnCv.height)
    this.clipped(this.tctx, this.cachedView, (ctx) => {
      for (const s of this.turnStrokes) drawStroke(ctx, s)
    })
    this.liveDrawn = 0
  }

  private blit(src: HTMLCanvasElement): void {
    const k = this.view.scale / this.cachedView.scale
    const ox = (this.view.tx - this.cachedView.tx * k) * this.dpr
    const oy = (this.view.ty - this.cachedView.ty * k) * this.dpr
    this.dctx.setTransform(k, 0, 0, k, ox, oy)
    this.dctx.drawImage(src, 0, 0)
  }

  private paint(): void {
    if (this.drawing) this.flushLive()

    this.dctx.setTransform(1, 0, 0, 1, 0, 0)
    this.dctx.fillStyle = SURROUND
    this.dctx.fillRect(0, 0, this.el.width, this.el.height)
    this.dctx.imageSmoothingQuality = 'high'
    this.blit(this.baseCv)
    this.blit(this.turnCv)

    if (this.drawing) {
      // The tip lives on the display canvas, which is cleared every frame, so
      // the last few samples can keep changing (exit taper, lift-snap) without
      // leaving a heavier ghost underneath.
      const s = this.drawing.builder.stroke
      this.clipped(this.dctx, this.view, (ctx) =>
        drawSegments(ctx, s, this.liveDrawn, s.pts.length),
      )
    }
  }

  /** Distance from the tip that must stay uncommitted, because finish() can
   *  still rewrite those widths. */
  private get holdBack(): number {
    const base = this.baseWidth()
    return base * this.opts.tuning.taper * 1.25 + 6
  }

  private flushLive(): void {
    const b = this.drawing!.builder
    const p = b.points
    const n = p.length
    if (n < 4) return
    let j = n - 1
    let d = 0
    const hold = this.holdBack
    while (j > 0 && d < hold) {
      d += dist(p[j].x, p[j].y, p[j - 1].x, p[j - 1].y)
      j--
    }
    j = Math.min(j, n - 3)
    if (j <= this.liveDrawn) return
    this.clipped(this.tctx, this.cachedView, (ctx) =>
      drawSegments(ctx, b.stroke, this.liveDrawn, j),
    )
    this.liveDrawn = j
  }

  // ----------------------------------------------------------------- input

  private baseWidth(): number {
    return this.opts.fixedWidth ?? PEN_WIDTHS[this.sizeIndex]
  }

  private css(e: { clientX: number; clientY: number }) {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top }
  }

  private report(): void {
    this.opts.onInk?.(this.inkUsed, this.opts.inkBudget)
    this.opts.onStrokes?.(this.turnStrokes.length)
  }

  private onContextMenu = (e: Event) => e.preventDefault()

  private onDown = (e: PointerEvent) => {
    e.preventDefault()
    const r = this.host.getBoundingClientRect()
    this.rect = { left: r.left, top: r.top }

    const c = this.css(e)
    this.pointers.set(e.pointerId, c)
    try {
      this.el.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone, or a synthesised event under test */
    }
    if (e.pointerType === 'pen') this.penSeen = true

    if (this.pointers.size >= 2) {
      if (this.opts.allowGestures === false) return
      // A second contact means pan/zoom, not a second line. If the stroke in
      // progress is barely started it was almost certainly the same gesture
      // landing unevenly, so throw it away rather than leaving a stray tick.
      if (this.drawing) {
        const b = this.drawing.builder
        if (b.points.length <= 6 || b.elapsed < 250) this.abortStroke()
        else this.endStroke()
      }
      this.startGesture()
      return
    }

    if (this.gesture) return
    if (this.locked) return
    // Once a stylus has been seen, touch is palm — it pans but never paints.
    if (this.penSeen && e.pointerType === 'touch') return
    if (this.inkUsed >= this.opts.inkBudget) return

    // The margin around the sheet is dead space — you can rest a hand there,
    // and a stroke can't be started on ink that would only ever be clipped.
    const lx = (c.x - this.view.tx) / this.view.scale
    const ly = (c.y - this.view.ty) / this.view.scale
    if (lx < 0 || ly < 0 || lx > this.opts.width || ly > this.opts.height) return

    // Guarantees cachedView === view for the whole stroke, which is what lets
    // the live layer be append-only.
    if (this.dirty) this.rebuild()

    const remaining = this.opts.inkBudget - this.inkUsed
    const builder = new StrokeBuilder(
      this.color,
      this.sizeIndex,
      this.baseWidth(),
      this.opts.tuning,
      remaining,
      Math.round(performance.now() - this.turnStart),
    )
    this.drawing = { id: e.pointerId, builder }
    this.liveDrawn = 0
    this.addSample(e, c)
    this.invalidate()
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    e.preventDefault()
    const c = this.css(e)
    this.pointers.set(e.pointerId, c)

    if (this.gesture) {
      this.updateGesture()
      this.invalidate()
      return
    }
    if (!this.drawing || this.drawing.id !== e.pointerId) return

    const events =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    if (events.length > 1) {
      for (const ce of events) this.addSample(ce, this.css(ce))
    } else {
      this.addSample(e, c)
    }
    this.report()
    this.invalidate()
  }

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId)
    try {
      if (this.el.hasPointerCapture(e.pointerId))
        this.el.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }

    if (this.gesture && (e.pointerId === this.gesture.a || e.pointerId === this.gesture.b)) {
      this.gesture = null
      this.clampView()
      this.invalidate(true)
      this.opts.onZoom?.(this.view.scale, this.fitScale)
      return
    }
    if (this.drawing && this.drawing.id === e.pointerId) {
      if (e.type === 'pointercancel') this.abortStroke()
      else this.endStroke()
      this.invalidate()
    }
  }

  private addSample(
    e: { clientX: number; clientY: number; pressure: number; pointerType: string },
    c: { x: number; y: number },
  ): void {
    const b = this.drawing!.builder
    b.add({
      lx: (c.x - this.view.tx) / this.view.scale,
      ly: (c.y - this.view.ty) / this.view.scale,
      cx: c.x,
      cy: c.y,
      pressure: e.pressure,
      pointerType: e.pointerType,
      t: performance.now(),
    })
  }

  private endStroke(): void {
    if (!this.drawing) return
    const b = this.drawing.builder
    const s = b.finish()
    this.drawing = null
    if (s && s.pts.length > 0) {
      this.turnStrokes.push(s)
      this.clipped(this.tctx, this.cachedView, (ctx) =>
        drawSegments(ctx, s, this.liveDrawn, s.pts.length),
      )
      if (import.meta.env.DEV) {
        // Per-stroke cost, so the ink budget is tuned against measurements
        // rather than against a guess about what a drawing costs.
        console.debug(
          `[ink] stroke ${this.turnStrokes.length}: ${Math.round(s.ink)}px ` +
            `(${s.pts.length} pts, ${s.color}, w${s.size}) — ` +
            `${Math.round(this.inkUsed)}/${this.opts.inkBudget} used, ` +
            `${Math.round(100 - (this.inkUsed / this.opts.inkBudget) * 100)}% left`,
        )
      }
    }
    this.liveDrawn = 0
    this.report()
  }

  private abortStroke(): void {
    if (!this.drawing) return
    this.drawing = null
    this.liveDrawn = 0
    this.rebuildTurn()
    this.report()
    this.invalidate()
  }

  // -------------------------------------------------------------- gestures

  private startGesture(): void {
    const ids = [...this.pointers.keys()].slice(0, 2)
    if (ids.length < 2) return
    const a = this.pointers.get(ids[0])!
    const b = this.pointers.get(ids[1])!
    this.gesture = {
      a: ids[0],
      b: ids[1],
      dist0: Math.max(1, dist(a.x, a.y, b.x, b.y)),
      midX0: (a.x + b.x) / 2,
      midY0: (a.y + b.y) / 2,
      view0: { ...this.view },
    }
  }

  private updateGesture(): void {
    const g = this.gesture!
    const a = this.pointers.get(g.a)
    const b = this.pointers.get(g.b)
    if (!a || !b) return
    const d = Math.max(1, dist(a.x, a.y, b.x, b.y))
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2

    const target = g.view0.scale * (d / g.dist0)
    const scale = Math.min(this.maxScale, Math.max(this.fitScale, target))
    const k = scale / g.view0.scale

    this.view = {
      scale,
      tx: midX - k * (g.midX0 - g.view0.tx),
      ty: midY - k * (g.midY0 - g.view0.ty),
    }
    this.clampView()
    this.dirty = true
  }

  private onWheel = (e: WheelEvent) => {
    if (this.opts.allowGestures === false) return
    e.preventDefault()
    const c = this.css(e)
    const factor = Math.exp(-e.deltaY * 0.0018)
    const scale = Math.min(
      this.maxScale,
      Math.max(this.fitScale, this.view.scale * factor),
    )
    const k = scale / this.view.scale
    this.view = {
      scale,
      tx: c.x - k * (c.x - this.view.tx),
      ty: c.y - k * (c.y - this.view.ty),
    }
    this.clampView()
    this.opts.onZoom?.(this.view.scale, this.fitScale)
    this.invalidate(true)
  }
}
