import { useEffect, useRef, useState } from 'react'
import { PAPER } from '../config'
import { fetchClosedCanvases, fetchLayers, type CanvasRow } from '../data/ledger'
import { LEDGER_ENABLED } from '../lib/supabase'
import { buildTimeline, paintRange } from '../engine/timelapse'
import { navigate } from './Router'

/**
 * The gallery as a wall.
 *
 * This is what makes "museum" literal, and it costs almost nothing because the
 * whole thing is already a web page: a browser in kiosk mode on a television,
 * a projector in a school corridor, a spare tablet on a shelf. Each canvas
 * fills in, rests, and gives way to the next, forever.
 *
 * On a wall this wants no chrome — but the same URL is reachable from inside
 * the app, from the gallery, and there "close the tab" is not an exit, it is a
 * dead end. So there is one way out, and it behaves the way a video player's
 * controls do: shown on arrival, then faded, and back the instant anything is
 * touched or moved or a key is pressed. A television nobody touches keeps its
 * clean full-bleed show; a phone that lands here has a door. Escape leaves too.
 *
 * It also keeps the screen awake if the browser will let it, because a
 * screensaver that gets replaced by an actual screensaver is a joke that only
 * lands once.
 */
const FILL_MS = 14000
const REST_MS = 5000

/** How long the way out lingers after the last sign of a person, before the
 *  wall goes back to being just the wall. */
const EXIT_LINGER_MS = 4000

export function ScreenPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [queue, setQueue] = useState<CanvasRow[]>([])
  const [at, setAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [caption, setCaption] = useState<{ seed: string; hands: number } | null>(null)
  const [exitShown, setExitShown] = useState(true)

  // The way out, and only when a person is here to want it. Every sign of one —
  // a moved pointer, a touch, a key — brings it back and restarts the linger;
  // Escape is a way out in itself. On a wall none of these ever fire, so after
  // the first few seconds it is gone and the show is full-bleed again.
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout>
    const wake = () => {
      setExitShown(true)
      clearTimeout(hide)
      hide = setTimeout(() => setExitShown(false), EXIT_LINGER_MS)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/gallery')
      else wake()
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(hide)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is nothing to show.')
      return
    }
    // The wall takes one batch and cycles it. Deliberately not paged: this
    // runs unattended on a display in a room, and something that quietly grew
    // its own memory all evening would be the wrong kind of clever.
    fetchClosedCanvases({ limit: 60 })
      .then(({ canvases }) => {
        if (canvases.length === 0) setError('Nothing has finished yet.')
        setQueue(canvases)
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

  const leave = (
    <button
      className={`screen-exit${exitShown ? '' : ' gone'}`}
      onClick={() => navigate('/gallery')}
    >
      ← Gallery
    </button>
  )

  if (error) {
    return (
      <div className="screen">
        {leave}
        <p className="screen-caption">{error}</p>
      </div>
    )
  }

  return (
    <div className="screen">
      {leave}
      <canvas ref={canvasRef} />
      {caption && (
        <p className="screen-caption">
          “{caption.seed}” · {caption.hands} hands
        </p>
      )}
    </div>
  )
}
