import { useEffect, useMemo, useState } from 'react'
import { renderLayers } from '../engine/render'
import { CANVAS_H, CANVAS_W, SLOTS_PER_CANVAS } from '../config'
import { loadCanvasForViewing } from '../data/session'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Replay, type ReplayLayer } from './Replay'

interface Props {
  canvasId: string
}

interface Loaded {
  seed: string
  closed: boolean
  slotCount: number
  closedAt: string | null
  layers: ReplayLayer[]
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/**
 * The shareable page a canvas gets when it closes — milestone 4.
 *
 * Rendered from stroke vectors at request time rather than from a stored image.
 * A canvas is a few tens of KB of JSON, so this is fast, always current, and
 * means the archive has exactly one representation to keep honest. The
 * server-side MP4 render is the same walk over the same data and is the one
 * piece of milestone 4 still outstanding.
 */
export function CanvasPage({ canvasId }: Props) {
  const [state, setState] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!LEDGER_ENABLED) {
      setError('This build has no ledger, so there is nothing to show here.')
      return
    }
    loadCanvasForViewing(canvasId)
      .then((r) => {
        if (!r) setError('No canvas with that id.')
        else setState(r)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [canvasId])

  const full = useMemo(
    () =>
      state
        ? renderLayers(
            CANVAS_W,
            CANVAS_H,
            state.layers.map((l) => l.strokes),
            { scale: 1 },
          )
        : null,
    [state],
  )

  if (error) {
    return (
      <div className="panel center">
        <h1>Nothing here</h1>
        <p>{error}</p>
        <div className="row">
          <a className="linkbtn" href="/">
            Take a slot instead
          </a>
        </div>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="panel center">
        <p className="stat">Loading the canvas…</p>
      </div>
    )
  }

  const hands = state.layers.length

  return (
    <div className="panel">
      <h1>“{state.seed}”</h1>
      <p>
        {state.closed
          ? `Finished by ${hands} hands. It can never be changed.`
          : `${hands} of ${state.slotCount} slots filled. Still open.`}
        {state.closedAt &&
          ` Closed ${new Date(state.closedAt).toLocaleDateString()}.`}
      </p>

      <div className="scroll">
        <Replay layers={state.layers} />

        <div className="review-caption">Take it with you</div>
        <div className="row">
          <button
            className="linkbtn"
            onClick={() =>
              full && download(full.toDataURL('image/png'), `longhand-${state.seed}.png`)
            }
          >
            Download the canvas
          </button>
          <button
            className="linkbtn"
            onClick={async () => {
              const url = location.href
              try {
                if (navigator.share) await navigator.share({ title: `Longhand — “${state.seed}”`, url })
                else {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }
              } catch {
                /* the share sheet was dismissed */
              }
            }}
          >
            {copied ? 'Link copied' : 'Share'}
          </button>
        </div>

        <div className="review-caption">Every hand, alone</div>
        <div className="cards">
          {state.layers.map((l) => (
            <LayerCard key={l.slotIndex} layer={l} seed={state.seed} />
          ))}
        </div>
      </div>

      <div className="row">
        <a className="linkbtn" href="/gallery">
          The gallery
        </a>
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          Take a slot
        </a>
      </div>
    </div>
  )
}

/** The personal card: one contributor's layer on bare paper. */
function LayerCard({ layer, seed }: { layer: ReplayLayer; seed: string }) {
  const src = useMemo(
    () =>
      renderLayers(CANVAS_W, CANVAS_H, [layer.strokes], { scale: 0.35 }).toDataURL(
        'image/png',
      ),
    [layer],
  )
  return (
    <figure className="card">
      <img src={src} alt={`Slot ${layer.slotIndex}`} />
      <figcaption>
        <span>
          {layer.slotIndex} / {SLOTS_PER_CANVAS}
        </span>
        <button
          className="linkbtn tiny"
          onClick={() =>
            download(
              renderLayers(CANVAS_W, CANVAS_H, [layer.strokes], {
                scale: 1,
              }).toDataURL('image/png'),
              `longhand-${seed}-slot-${layer.slotIndex}.png`,
            )
          }
        >
          Save
        </button>
      </figcaption>
    </figure>
  )
}
