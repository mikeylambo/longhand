import { useEffect, useRef, useState } from 'react'
import { PAPER } from '../config'
import { decodeLayer, type EncodedLayer } from '../engine/codec'
import { buildTimeline, paintRange } from '../engine/timelapse'

interface Baked {
  v: 1
  seed: string
  w: number
  h: number
  layers: EncodedLayer[]
}

/** Six seconds to fill, then a moment to look at it, then again. */
const FILL_MS = 6000
const HOLD_MS = 1400

/**
 * The band of the sheet the clip shows, as fractions of its height.
 *
 * The sheet is square and this scene puts its horizon at 58% of the way down,
 * so the whole thing shown whole is a third empty sky above a drawing. On a
 * phone that empty third is the difference between the button being on screen
 * and being below the fold. Cropping is a framing decision about one fixed
 * fixture, not a rule about canvases — nothing else in the product crops.
 */
const TOP = 0.18
const BOTTOM = 0.97

/**
 * The teaching object.
 *
 * A finished canvas assembling itself explains the whole product without a
 * word of instruction: hands arrive one at a time, each one adds, nothing that
 * arrived earlier goes away. Every attempt to say that in prose was longer and
 * worse.
 *
 * It is the timelapse walk rather than a video file — the same
 * `buildTimeline`/`paintRange` the scrubber and the MP4 export use, which
 * `selftest` proves lands on identical pixels however many steps it takes. So
 * there is no muxing, no autoplay policy to negotiate, no audio track to
 * promise is muted, and it stays sharp on any screen.
 */
export function WelcomeReel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<Baked | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/welcome-canvas.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setDoc(d))
      .catch(() => {
        /* the screen reads fine without it; it must never block the button */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !doc) return

    const layers = doc.layers.map((l, i) => ({
      slotIndex: i + 1,
      strokes: decodeLayer(l),
    }))
    const timeline = buildTimeline(layers)
    const ctx = cv.getContext('2d')!
    const scale = cv.width / doc.w
    const offset = -doc.h * TOP * scale

    let drawn = 0
    const clear = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = PAPER
      ctx.fillRect(0, 0, cv.width, cv.height)
      ctx.setTransform(scale, 0, 0, scale, 0, offset)
      drawn = 0
    }
    const to = (target: number) => {
      paintRange(ctx, timeline, drawn, target)
      drawn = target
    }

    clear()

    // Someone who has asked for less motion gets the finished piece, held.
    // It still says the thing the animation says; it just says it at once.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      to(timeline.total)
      return
    }

    let raf = 0
    let began = performance.now()
    const tick = (now: number) => {
      const elapsed = now - began
      if (elapsed >= FILL_MS + HOLD_MS) {
        began = now
        clear()
      } else {
        to(Math.round(Math.min(1, elapsed / FILL_MS) * timeline.total))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [doc])

  return (
    <div className="reel">
      <canvas
        ref={canvasRef}
        width={doc ? Math.round(doc.w / 2) : 1024}
        height={doc ? Math.round((doc.h * (BOTTOM - TOP)) / 2) : 810}
        aria-label="A finished canvas filling in, one hand at a time"
      />
    </div>
  )
}
