import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CANVAS_H, CANVAS_W, PAPER } from '../config'
import {
  buildTimeline,
  paintRange,
  type TimelapseLayer,
} from '../engine/timelapse'

export type ReplayLayer = TimelapseLayer

interface Props {
  layers: ReplayLayer[]
  /** ~20s is the brief's watchable length for twelve slots. */
  durationMs?: number
}

/**
 * The timelapse, rendered from the ledger rather than from a video file.
 *
 * This is the milestone 2 proof: if strokes replay correctly and can be
 * isolated per contributor, then vectors really are the single source of truth
 * — and the server-side MP4 render at milestone 4 is the same walk over the
 * same data, through `buildTimeline`/`paintRange`.
 *
 * Playback advances monotonically, so frames composite incrementally onto a
 * persistent canvas; only scrubbing backwards or toggling a contributor forces
 * a rebuild. `selftest` proves that stepping the walk in 2, 7 or 113 chunks
 * lands on pixels identical to one pass.
 */
export function Replay({ layers, durationMs = 20000 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawnRef = useRef(0)
  const rafRef = useRef(0)
  const startedRef = useRef(0)

  const [visible, setVisible] = useState<Set<number>>(
    () => new Set(layers.map((l) => l.slotIndex)),
  )
  const [pos, setPos] = useState(1)
  const [playing, setPlaying] = useState(false)

  const timeline = useMemo(
    () => buildTimeline(layers, visible),
    [layers, visible],
  )

  const paint = useCallback(
    (target: number) => {
      const cv = canvasRef.current
      if (!cv) return
      const ctx = cv.getContext('2d')!
      const scale = cv.width / CANVAS_W

      if (target < drawnRef.current) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.fillStyle = PAPER
        ctx.fillRect(0, 0, cv.width, cv.height)
        drawnRef.current = 0
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      paintRange(ctx, timeline, drawnRef.current, target)
      drawnRef.current = target
    },
    [timeline],
  )

  // Any change to what is visible invalidates the accumulated pixels.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, cv.width, cv.height)
    drawnRef.current = 0
    paint(Math.round(pos * timeline.total))
  }, [timeline, paint, pos])

  useEffect(() => {
    if (!playing) return
    startedRef.current = performance.now() - pos * durationMs
    const tick = () => {
      const p = Math.min(1, (performance.now() - startedRef.current) / durationMs)
      setPos(p)
      if (p >= 1) setPlaying(false)
      else rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // pos is intentionally read once, at the moment play begins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, durationMs])

  const toggle = (slot: number) =>
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })

  return (
    <div className="replay">
      <canvas
        ref={canvasRef}
        className="review-art"
        width={CANVAS_W / 2}
        height={CANVAS_H / 2}
      />

      <div className="row">
        <button
          className="linkbtn"
          onClick={() => {
            if (pos >= 1) setPos(0)
            setPlaying(!playing)
          }}
        >
          {playing ? 'Pause' : pos >= 1 ? 'Watch again' : 'Watch it fill in'}
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={pos}
          onChange={(e) => {
            setPlaying(false)
            setPos(Number(e.target.value))
          }}
          aria-label="Scrub the timelapse"
        />
      </div>

      <div className="review-caption">Hands — tap to isolate</div>
      <div className="slots">
        {layers.map((l) => (
          <button
            key={l.slotIndex}
            className={`slotchip${visible.has(l.slotIndex) ? ' on' : ''}`}
            onClick={() => toggle(l.slotIndex)}
          >
            {l.slotIndex}
          </button>
        ))}
      </div>
    </div>
  )
}
