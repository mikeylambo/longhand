import { useEffect, useRef, useState } from 'react'
import { PAPER } from '../config'
import { fetchClosedCanvases, fetchLayers, type CanvasRow } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { buildTimeline, paintRange } from '../engine/timelapse'

/**
 * The gallery as a wall.
 *
 * This is what makes "museum" literal, and it costs almost nothing because the
 * whole thing is already a web page: a browser in kiosk mode on a television,
 * a projector in a school corridor, a spare tablet on a shelf. Each canvas
 * fills in, rests, and gives way to the next, forever.
 *
 * No chrome, no controls, no cursor. The only interface is closing the tab.
 * It also keeps the screen awake if the browser will let it, because a
 * screensaver that gets replaced by an actual screensaver is a joke that only
 * lands once.
 */
const FILL_MS = 14000
const REST_MS = 5000

export function ScreenPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [queue, setQueue] = useState<CanvasRow[]>([])
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [caption, setCaption] = useState<{ seed: string; hands: number } | null>(null)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is nothing to show.')
      return
    }
    fetchClosedCanvases(60)
      .then((rows) => {
        if (rows.length === 0) setError('Nothing has finished yet.')
        setQueue(rows)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // Best effort, and genuinely optional: a wall display that dims is a wall
  // display somebody has to walk over to.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> }
    }
    nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => {
      void lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const canvas = queue[at]
    const cv = canvasRef.current
    if (!canvas || !cv) return

    let raf = 0
    let cancelled = false

    fetchLayers(canvas.id)
      .then((layers) => {
        if (cancelled) return
        const w = canvas.width ?? 2048
        const h = canvas.height ?? 2048
        cv.width = Math.round(w / 2)
        cv.height = Math.round(h / 2)
        const ctx = cv.getContext('2d')!
        const timeline = buildTimeline(
          layers.map((l) => ({ slotIndex: l.slotIndex, strokes: l.strokes })),
        )
        setCaption({ seed: canvas.seed_word, hands: layers.length })

        const scale = cv.width / w
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = PAPER
        ctx.fillRect(0, 0, cv.width, cv.height)
        ctx.setTransform(scale, 0, 0, scale, 0, 0)

        let drawn = 0
        const began = performance.now()
        const tick = (now: number) => {
          const t = now - began
          if (t >= FILL_MS + REST_MS) {
            setAt((i) => (i + 1) % queue.length)
            return
          }
          const target = Math.round(Math.min(1, t / FILL_MS) * timeline.total)
          if (target > drawn) {
            paintRange(ctx, timeline, drawn, target)
            drawn = target
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      })
      .catch(() => {
        // One canvas failing to load must not end the show.
        setAt((i) => (i + 1) % Math.max(1, queue.length))
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [queue, at])

  if (error) {
    return (
      <div className="screen">
        <p className="screen-caption">{error}</p>
      </div>
    )
  }

  return (
    <div className="screen">
      <canvas ref={canvasRef} />
      {caption && (
        <p className="screen-caption">
          “{caption.seed}” · {caption.hands} hands
        </p>
      )}
    </div>
  )
}
