import { useEffect, useRef, useState } from 'react'
import { Surface } from '../engine/surface'
import type { Stroke } from '../engine/types'
import {
  CANVAS_H,
  CANVAS_W,
  MASTER_PALETTE,
  PEN_WIDTHS,
  SHOW_TUNER,
  SLOTS_PER_CANVAS,
  TUNING,
  type Tuning,
} from '../config'
import { FitIcon, UndoIcon } from './icons'
import { Tuner } from './Tuner'

interface Props {
  seed: string
  slot: number
  priorLayers: Stroke[][]
  onSubmit: (layer: Stroke[]) => void
}

export function DrawTurn({ seed, slot, priorLayers, onSubmit }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<Surface | null>(null)

  const [ink, setInk] = useState(0)
  const [budget, setBudget] = useState(TUNING.inkBudget)
  const [strokeCount, setStrokeCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [color, setColor] = useState<string>(MASTER_PALETTE[0])
  const [size, setSize] = useState(1)
  const [tuning, setTuning] = useState<Tuning>(TUNING)
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const s = new Surface(host, {
      width: CANVAS_W,
      height: CANVAS_H,
      tuning: TUNING,
      inkBudget: TUNING.inkBudget,
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
          Slot {slot} / {SLOTS_PER_CANVAS}
        </div>
        <div className="seed">“{seed}”</div>
        <div className="right">
          <button
            className="linkbtn solid"
            disabled={strokeCount === 0}
            onClick={() => onSubmit(surfaceRef.current?.getLayer() ?? [])}
          >
            Finish
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
        {showHint && (
          <div className="hint">Two fingers to move and zoom</div>
        )}
      </div>

      <div className="palette">
        {MASTER_PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch${c === color ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  )
}
