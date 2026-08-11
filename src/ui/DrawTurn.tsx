import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Surface, type Tool } from '../engine/surface'
import { STAMPS } from '../engine/tools'
import type { Stroke } from '../engine/types'
import {
  PEN_WIDTHS,
  SHOW_TUNER,
  TUNING,
  type Tuning,
} from '../config'
import { FitIcon, RedoIcon, ToolsIcon, UndoIcon } from './icons'
import { Tuner } from './Tuner'
import { TurnClock } from './TurnClock'
import { PaletteBar } from './PaletteBar'
import { washAllowed } from '../colour'
import { ReportButton } from './ReportButton'
import { clearDraft, loadDraft, saveDraft } from '../data/draft'
import { coachingDone, markSeen, nextLesson, seenLessons, type Lesson } from './coach'

/**
 * What the tray offers, in the order it offers it.
 *
 * The pen first because it is the product; the wash and the fill last because
 * they act on what other people left and only make sense once there is
 * something there. Stamps second because they are the reason somebody who says
 * they cannot draw puts anything down at all.
 */
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'pen', label: 'Pen' },
  { id: 'stamp', label: 'Stamps' },
  { id: 'hatch', label: 'Hatch' },
  { id: 'stipple', label: 'Stipple' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'wash', label: 'Wash' },
  { id: 'fill', label: 'Fill' },
]

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
  /** Hands the slot back rather than making the canvas wait out the clock. */
  onLeave: () => void
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
  onLeave,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<Surface | null>(null)

  const [ink, setInk] = useState(0)
  const [budget, setBudget] = useState(TUNING.inkBudget)
  const [strokeCount, setStrokeCount] = useState(0)
  const [redoable, setRedoable] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [fitScale, setFitScale] = useState(1)
  const [color, setColor] = useState<string>(palette[0])
  const [size, setSize] = useState(1)
  const [tuning, setTuning] = useState<Tuning>(TUNING)
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [openedTools, setOpenedTools] = useState(false)
  const [expired, setExpired] = useState(false)
  const [tool, setTool] = useState<Tool>('pen')
  const [stampIdx, setStampIdx] = useState(0)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  /** Which turn a draft belongs to. Stable across renders so the save effect
   *  fires on the drawing changing, not on the component re-rendering. */
  const draftTurn = useMemo(
    () => ({ canvasId, slot, expiresAt }),
    [canvasId, slot, expiresAt],
  )

  // When the clock runs out the pen stops working, but the sheet stays on
  // screen — vanishing the drawing the instant it is lost would be crueller
  // than showing what was lost.
  const handleExpired = useCallback(() => {
    setExpired(true)
    surfaceRef.current?.setLocked(true)
    // The turn is unrecoverable, so the draft is too. Dropped rather than left
    // to rot: it can be most of a megabyte, and it will never match again.
    clearDraft()
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
      onRedoable: setRedoable,
      onZoom: (z, f) => {
        setZoom(z)
        setFitScale(f)
      },
    })
    s.setPriorLayers(priorLayers)
    // A fill that refuses has to say so. Doing nothing visible leaves somebody
    // tapping a region that will never take, deciding the app is broken.
    s.onFillRefused((why) =>
      setRefusal(
        why === 'escaped'
          ? 'That is not closed in — the colour would run across the whole sheet.'
          : 'Nothing to fill there. Tap inside a shape somebody has outlined.',
      ),
    )
    surfaceRef.current = s

    // Before anything can be drawn, and only for this exact turn. A draft from
    // a slot that has since expired and been reclaimed is not this turn's, and
    // loadDraft refuses it on the key rather than trusting the caller.
    const draft = loadDraft(draftTurn, width, height)
    if (draft) s.restoreTurn(draft)

    return () => {
      surfaceRef.current = null
      s.destroy()
    }
    // Mounted once per slot; the parent remounts with a new key on each turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => surfaceRef.current?.setColor(color), [color])
  useEffect(() => surfaceRef.current?.setTool(tool), [tool])
  useEffect(() => surfaceRef.current?.setStamp(STAMPS[stampIdx]), [stampIdx])
  useEffect(() => surfaceRef.current?.setSizeIndex(size), [size])
  useEffect(() => surfaceRef.current?.setTuning(tuning), [tuning])
  useEffect(() => surfaceRef.current?.setInkBudget(tuning.inkBudget), [tuning.inkBudget])

  /**
   * The first turn, taught one thing at a time. See `coach.ts` for why this is
   * not a tour.
   *
   * Held for the life of the turn rather than re-read per render, so a lesson
   * is marked once when it appears rather than once per stroke.
   */
  const seen = useRef(seenLessons())
  const coached = useRef(coachingDone())

  useEffect(() => {
    if (coached.current || lesson || expired) return
    const next = nextLesson(
      {
        strokes: strokeCount,
        inkUsedFraction: budget > 0 ? ink / budget : 0,
        openedTools,
      },
      seen.current,
    )
    if (!next) return
    markSeen(next.id, seen.current)
    setLesson(next)
  }, [strokeCount, ink, budget, openedTools, lesson, expired])

  // Long enough to read twice, short enough not to sit over the drawing. The
  // next queued lesson appears after it, never on top of it.
  useEffect(() => {
    if (!lesson) return
    const id = setTimeout(() => setLesson(null), 5200)
    return () => clearTimeout(id)
  }, [lesson])

  /**
   * Keeps the draft in step with the sheet.
   *
   * Driven by the counts rather than by a stroke-ended callback because undo
   * and redo change what is on the sheet without adding anything, and a draft
   * that ignored them would restore work somebody had deliberately taken back.
   *
   * Debounced so that a burst — a fill, a row of stamps, a held undo — writes
   * once. Half a second is well inside the gap between a tab going to the
   * background and the OS deciding to discard it.
   */
  useEffect(() => {
    const s = surfaceRef.current
    if (!s || expired) return
    const id = setTimeout(() => saveDraft(draftTurn, s.getLayer(), width, height), 500)
    return () => clearTimeout(id)
  }, [strokeCount, redoable, expired, draftTurn, width, height])

  /**
   * The debounce is a window in which work can be lost, so the two moments a
   * phone actually takes a tab away close it immediately. `pagehide` rather
   * than `unload`, which iOS does not reliably fire; `visibilitychange` because
   * backgrounding is the common case and nothing guarantees a later event.
   */
  useEffect(() => {
    if (expired) return
    const flush = () => {
      const s = surfaceRef.current
      if (s) saveDraft(draftTurn, s.getLayer(), width, height)
    }
    const onHidden = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [expired, draftTurn, width, height])

  useEffect(() => {
    if (!refusal) return
    const id = setTimeout(() => setRefusal(null), 3400)
    return () => clearTimeout(id)
  }, [refusal])

  // The two tools that multiply are held to the lighter half of the range, so
  // a wash tints rather than blots. Switching to one while holding ink moves
  // you to something you can actually use rather than leaving a pen that does
  // nothing when you drag it.
  const tintOnly = tool === 'wash' || tool === 'fill'
  useEffect(() => {
    if (!tintOnly || washAllowed(color)) return
    const light = palette.find(washAllowed)
    if (light) setColor(light)
  }, [tintOnly, color, palette])

  const remaining = Math.max(0, 1 - ink / Math.max(1, budget))
  const zoomLabel = fitScale > 0 ? Math.round((zoom / fitScale) * 100) : 100

  /**
   * A slot is gone once it is used, so a single tap should not be able to
   * spend one. Measured in ink rather than strokes because a stroke count
   * cannot tell a dot from a line — playtesting found somebody could submit a
   * single dot and take a twelfth of a canvas with it.
   */
  const enoughInk = ink >= TUNING.minInk
  const started = strokeCount > 0

  // Fit did nothing whenever the sheet was already fitted, which reads as a
  // broken button rather than an unavailable one. Now that you can zoom out
  // past fit as well as in, it is live whenever you are anywhere else.
  const atFit = fitScale > 0 && Math.abs(zoom - fitScale) < fitScale * 0.005

  return (
    <div className="app">
      {SHOW_TUNER && <Tuner tuning={tuning} onChange={setTuning} />}

      <header className="topbar">
        <div className="slot">
          Slot {slot} / {slotCount}
          <TurnClock expiresAt={expiresAt} onExpired={handleExpired} />
          {/* There was no way out of a claimed slot short of waiting ten
              minutes for the clock, which makes everyone else on the canvas
              wait too. Two steps when there is work to lose, one when there
              is not. */}
          {!expired && (
            <button
              className={`leave${leaving ? ' arm' : ''}`}
              onClick={() => {
                if (!started || leaving) onLeave()
                else setLeaving(true)
              }}
            >
              {leaving ? 'Sure? The drawing goes' : 'Give the slot back'}
            </button>
          )}
        </div>
        <div className="seed">“{seed}”</div>
        <div className="right">
          <button
            className="linkbtn solid"
            disabled={!enoughInk || expired || submitting}
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
            className={`tool${tool !== 'pen' ? ' on' : ''}`}
            onClick={() => {
              setToolsOpen((v) => !v)
              setOpenedTools(true)
            }}
            aria-label="Other tools"
          >
            <ToolsIcon />
          </button>
          <button
            className="tool"
            disabled={strokeCount === 0}
            onClick={() => surfaceRef.current?.undo()}
            aria-label="Undo your last stroke"
          >
            <UndoIcon />
          </button>
          {/* Sits next to undo and is disabled rather than hidden, so the tray
              does not change height the first time anything is undone. */}
          <button
            className="tool"
            disabled={redoable === 0}
            onClick={() => surfaceRef.current?.redo()}
            aria-label="Redo the stroke you undid"
          >
            <RedoIcon />
          </button>
          <button
            className="tool"
            disabled={atFit}
            onClick={() => surfaceRef.current?.fit()}
            aria-label="Fit the whole canvas"
          >
            <FitIcon />
          </button>
        </div>

        <div className="zoomtag">{zoomLabel}%</div>
        {/* One hint slot, and an order rather than three things that can
            stack on each other. A refusal answers a tap that just happened and
            has to win; the ink floor explains a disabled button in front of
            them; a lesson is the least urgent thing here and waits. */}
        {!expired &&
          (refusal ? null : started && !enoughInk ? (
            <div className="hint" role="status">
              A little more than that, and it is yours to finish
            </div>
          ) : lesson ? (
            <div className={`hint lesson at-${lesson.at}`} role="status">
              {lesson.text}
            </div>
          ) : null)}
        {/* Only once there is somebody else's work on the sheet — an empty
            canvas has nothing to report, and offering it anyway would read as
            an invitation. */}
        {canvasId && priorLayers.length > 0 && !expired && (
          <ReportButton canvasId={canvasId} className="report-corner" />
        )}
        {refusal && !expired && (
          <div className="hint refusal" role="status">
            {refusal}
          </div>
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
              <strong>Time’s up for this turn.</strong>
              <p>
                The slot goes back for the next artist, so nothing you drew here
                was saved. A fresh one is yours whenever you are ready.
              </p>
              <button className="linkbtn solid" onClick={onExpired}>
                Take another slot
              </button>
            </div>
          </div>
        )}
      </div>

      {toolsOpen && (
        <div className="tooltray">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`toolchip${tool === t.id ? ' on' : ''}`}
              onClick={() => {
                setTool(t.id)
                if (t.id !== 'stamp') setToolsOpen(false)
              }}
            >
              {t.label}
            </button>
          ))}
          {tool === 'stamp' && (
            <div className="stamprow">
              {STAMPS.map((st, i) => (
                <button
                  key={st.id}
                  className={`toolchip${i === stampIdx ? ' on' : ''}`}
                  onClick={() => {
                    setStampIdx(i)
                    setToolsOpen(false)
                  }}
                >
                  {st.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <PaletteBar
        palette={palette}
        value={color}
        onChange={setColor}
        allow={tintOnly ? washAllowed : undefined}
      />
    </div>
  )
}
