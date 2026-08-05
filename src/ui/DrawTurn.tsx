import { useCallback, useEffect, useRef, useState } from 'react'
import { Surface } from '../engine/surface'
import type { Stroke } from '../engine/types'
import {
  PEN_WIDTHS,
  SHOW_TUNER,
  TUNING,
  type Tuning,
} from '../config'
import { FitIcon, UndoIcon } from './icons'
import { Tuner } from './Tuner'
import { TurnClock } from './TurnClock'
import { PaletteBar } from './PaletteBar'
import { ReportButton } from './ReportButton'

interface Props {
  seed: string
  slot: number
  /** How many hands this canvas takes. Read from the canvas, never a constant. */
  slotCount: number
  /** Palette inheritance: what's already on the canvas, plus two new colours. */
  palette: string[]
  priorLayers: Stroke[][]
  /** The sheet this canvas was opened at, not the current default. */
  width: number
  height: number
  /** Epoch ms this turn runs out, or null when no clock is running. */
  expiresAt: number | null
  /** Null in local mode, where there is nothing to report to. */
  canvasId: string | null
  submitting: boolean
  /** A failed save. Shown over the drawing, which is never discarded. */
  submitError: string | null
  onDismissError: () => void
  onSubmit: (layer: Stroke[]) => void
  onExpired: () => void
}

export function DrawTurn({
  seed,
  slot,
  slotCount,
  palette,
  priorLayers,
  width,
  height,
  expiresAt,
  canvasId,
  submitting,
  submitError,
  onDismissError,
  onSubmit,
  onExpired,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<Surface | null>(null)

  const [ink, setInk] = useState(0)
  const [budget, setBudget] = useState(TUNING.inkBudget)
  const [strokeCount, setStrokeCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [color, setColor] = useState<string>(palette[0])
  const [size, setSize] = useState(1)
  const [tuning, setTuning] = useState<Tuning>(TUNING)
  const [showHint, setShowHint] = useState(true)
  const [expired, setExpired] = useState(false)

  // When the clock runs out the pen stops working, but the sheet stays on
  // screen — vanishing the drawing the instant it is lost would be crueller
  // than showing what was lost.
  const handleExpired = useCallback(() => {
    setExpired(true)
    surfaceRef.current?.setLocked(true)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const s = new Surface(host, {
      width,
      height,
      tuning: TUNING,
      inkBudget: TUNING.inkBudget,
      // Edge to edge. On a phone the sheet should be the surface, not an
      // object sitting on one.
      fitPad: 1,
      onInk: (used, b) => {
        setInk(used)
        setBudget(b)
      },
      onStrokes: setStrokeCount,
      onZoom: (z, f) => {
        setZoom(z)
        setFitScale(f)
      },
    })
    s.setPriorLayers(priorLayers)
    surfaceRef.current = s
    return () => {
      surfaceRef.current = null
      s.destroy()
    }
    // Mounted once per slot; the parent remounts with a new key on each turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => surfaceRef.current?.setColor(color), [color])
  useEffect(() => surfaceRef.current?.setSizeIndex(size), [size])
  useEffect(() => surfaceRef.current?.setTuning(tuning), [tuning])
  useEffect(() => surfaceRef.current?.setInkBudget(tuning.inkBudget), [tuning.inkBudget])

  useEffect(() => {
    if (strokeCount > 0) setShowHint(false)
  }, [strokeCount])

  const remaining = Math.max(0, 1 - ink / Math.max(1, budget))
  const zoomLabel = fitScale > 0 ? Math.round((zoom / fitScale) * 100) : 100

  return (
    <div className="app">
      {SHOW_TUNER && <Tuner tuning={tuning} onChange={setTuning} />}

      <header className="topbar">
        <div className="slot">
          Slot {slot} / {slotCount}
          <TurnClock expiresAt={expiresAt} onExpired={handleExpired} />
        </div>
        <div className="seed">“{seed}”</div>
        <div className="right">
          <button
            className="linkbtn solid"
            disabled={strokeCount === 0 || expired || submitting}
            onClick={() => onSubmit(surfaceRef.current?.getLayer() ?? [])}
          >
            {submitting ? 'Saving…' : 'Finish'}
          </button>
        </div>
      </header>

      <div className="ink">
        <div className="ink-track">
          <div
            className={`ink-fill${remaining < 0.15 ? ' low' : ''}`}
            style={{ transform: `scaleX(${remaining})` }}
          />
        </div>
        <div className="ink-label">
          <span>Ink</span>
          <span>{remaining <= 0 ? 'Empty' : `${Math.round(remaining * 100)}%`}</span>
        </div>
      </div>

      <div className="stage" ref={hostRef}>
        <div className="sidetools">
          {PEN_WIDTHS.map((w, i) => (
            <button
              key={w}
              className={`tool${i === size ? ' on' : ''}`}
              onClick={() => setSize(i)}
              aria-label={['Thin pen', 'Medium pen', 'Broad pen'][i]}
            >
              <span
                className="nib"
                style={{ width: 4 + i * 5, height: 4 + i * 5 }}
              />
            </button>
          ))}
          <button
            className="tool"
            disabled={strokeCount === 0}
            onClick={() => surfaceRef.current?.undo()}
            aria-label="Undo your last stroke"
          >
            <UndoIcon />
          </button>
          <button
            className="tool"
            onClick={() => surfaceRef.current?.fit()}
            aria-label="Fit the whole canvas"
          >
            <FitIcon />
          </button>
        </div>

        <div className="zoomtag">{zoomLabel}%</div>
        {showHint && !expired && (
          <div className="hint">Two fingers to move and zoom</div>
        )}
        {/* Only once there is somebody else's work on the sheet — an empty
            canvas has nothing to report, and offering it anyway would read as
            an invitation. */}
        {canvasId && priorLayers.length > 0 && !expired && (
          <ReportButton canvasId={canvasId} className="report-corner" />
        )}
        {submitError && !expired && (
          <div className="banner" role="alert">
            <span>{submitError}</span>
            <button className="linkbtn tiny" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        )}
        {expired && (
          <div className="expired">
            <div>
              <strong>Your turn ran out.</strong>
              <p>
                The slot has gone back to the pool for someone else. Nothing you
                drew was saved.
              </p>
              <button className="linkbtn solid" onClick={onExpired}>
                Take another slot
              </button>
            </div>
          </div>
        )}
      </div>

      <PaletteBar palette={palette} value={color} onChange={setColor} />
    </div>
  )
}
