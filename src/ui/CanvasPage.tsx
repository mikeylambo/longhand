import { useEffect, useMemo, useState } from 'react'
import { renderLayers } from '../engine/render'
import { formatFor } from '../config'
import { loadCanvasForViewing, type ViewLayer } from '../data/session'
import { LEDGER_ENABLED } from '../lib/supabase'
import { Replay } from './Replay'
import { renderTimelapseVideo, videoExportSupported } from '../engine/video'
import { ReportButton } from './ReportButton'
import { cachedSignatureId, requestPrint } from '../data/ledger'
import { Footer } from './Footer'

interface Props {
  canvasId: string
}

interface Loaded {
  seed: string
  width: number
  height: number
  closed: boolean
  slotCount: number
  closedAt: string | null
  layers: ViewLayer[]
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
 *
 * It also serves a canvas that is still filling, which is not a lesser case:
 * it is the link a player leaves with, and the only thing that will tell them
 * their canvas finished until notifications exist.
 */
export function CanvasPage({ canvasId }: Props) {
  const [state, setState] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [videoProgress, setVideoProgress] = useState<number | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [printState, setPrintState] = useState<'idle' | 'asking' | 'asked'>('idle')
  const [printError, setPrintError] = useState<string | null>(null)

  const saveTimelapse = async (loaded: Loaded) => {
    setVideoError(null)
    setVideoProgress(0)
    try {
      const { blob, extension } = await renderTimelapseVideo({
        layers: loaded.layers,
        width: loaded.width,
        height: loaded.height,
        seed: loaded.seed,
        hands: loaded.layers.length,
        onProgress: setVideoProgress,
      })
      const url = URL.createObjectURL(blob)
      download(url, `foolscap-${loaded.seed}.${extension}`)
      // Revoked late: Safari cancels an in-flight download if the object URL
      // goes away too soon.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : String(e))
    } finally {
      setVideoProgress(null)
    }
  }

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
            state.width,
            state.height,
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
  const format = formatFor(state.slotCount)
  const waiting = Math.max(0, state.slotCount - hands)

  return (
    <div className="panel">
      <h1>
        “{state.seed}” <span className="chip">{format.title}</span>
      </h1>
      <p>
        {state.closed
          ? `Finished by ${format.hands} hands${
              state.closedAt
                ? ` on ${new Date(state.closedAt).toLocaleDateString()}`
                : ''
            }. It can never be changed.`
          : waiting === 1
            ? `${hands} of ${state.slotCount} hands. One more closes it.`
            : `${hands} of ${state.slotCount} hands. Still filling.`}
      </p>

      <div className="scroll">
        <Replay
          layers={state.layers}
          width={state.width}
          height={state.height}
        />

        <div className="review-caption">Take it with you</div>
        <div className="row">
          {videoExportSupported() && (
            <button
              className="linkbtn"
              disabled={videoProgress !== null}
              onClick={() => void saveTimelapse(state)}
            >
              {videoProgress === null
                ? 'Save the timelapse'
                : `Rendering… ${Math.round(videoProgress * 100)}%`}
            </button>
          )}
          <button
            className="linkbtn"
            onClick={() =>
              full && download(full.toDataURL('image/png'), `foolscap-${state.seed}.png`)
            }
          >
            Download the canvas
          </button>
          <button
            className="linkbtn"
            onClick={async () => {
              const url = location.href
              try {
                if (navigator.share) await navigator.share({ title: `Foolscap — “${state.seed}”`, url })
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
        {videoProgress !== null && (
          <div className="stat">
            Recording in real time — about 20 seconds. Keep this tab in front.
          </div>
        )}
        {videoError && <div className="stat">Timelapse failed: {videoError}</div>}

        <div className="review-caption">Every hand, alone</div>
        <div className="cards">
          {state.layers.map((l) => (
            <LayerCard
              key={l.slotIndex}
              layer={l}
              canvasId={canvasId}
              seed={state.seed}
              slotCount={state.slotCount}
              width={state.width}
              height={state.height}
            />
          ))}
        </div>
        {waiting > 0 && (
          <div className="cards">
            {Array.from({ length: waiting }, (_, i) => (
              <div className="card waiting" key={i}>
                <div className="card-placeholder" />
                <figcaption>
                  <span>{hands + i + 1} / {state.slotCount}</span>
                  <span>waiting</span>
                </figcaption>
              </div>
            ))}
          </div>
        )}

        {state.closed && cachedSignatureId() && (
          <>
            <div className="review-caption">On paper</div>
            <p className="stat">
              A print carries every signature on the back. Asking asks everybody
              who drew on it as well — nothing is made unless all of them say
              yes, which is what the terms promise and this is how it is kept.
            </p>
            <div className="row">
              <button
                className="linkbtn"
                disabled={printState !== 'idle'}
                onClick={async () => {
                  setPrintState('asking')
                  try {
                    await requestPrint(canvasId)
                    setPrintState('asked')
                  } catch (e) {
                    setPrintError(e instanceof Error ? e.message : String(e))
                    setPrintState('idle')
                  }
                }}
              >
                {printState === 'asked'
                  ? 'Everybody has been asked'
                  : printState === 'asking'
                    ? 'Asking…'
                    : 'Ask about a print'}
              </button>
              <a className="linkbtn quiet" href={`/ar/${canvasId}`}>
                See it in the room
              </a>
            </div>
            {printError && <p className="stat error">{printError}</p>}
          </>
        )}

        <div className="review-caption">Something wrong with it?</div>
        <div className="row">
          <ReportButton canvasId={canvasId} label="Report this canvas" />
        </div>
        <p className="stat">
          One tap, nothing to write. A person reads these, and what we can do
          is hide a hand or take the canvas off the shelf — never delete it.
        </p>
      </div>

      <div className="row">
        <div className="spacer" />
        <a className="linkbtn solid" href="/">
          {state.closed ? 'Take a slot elsewhere' : 'Take a slot'}
        </a>
      </div>

      <Footer wander />
    </div>
  )
}

/** The personal card: one contributor's layer on bare paper. */
function LayerCard({
  layer,
  canvasId,
  seed,
  slotCount,
  width,
  height,
}: {
  layer: ViewLayer
  canvasId: string
  seed: string
  slotCount: number
  width: number
  height: number
}) {
  const src = useMemo(
    () =>
      renderLayers(width, height, [layer.strokes], { scale: 0.35 }).toDataURL(
        'image/png',
      ),
    [layer, width, height],
  )
  return (
    <figure className="card">
      <img src={src} alt={`Slot ${layer.slotIndex}`} />
      <figcaption>
        <span>
          {layer.slotIndex} / {slotCount}
        </span>
        <button
          className="linkbtn tiny"
          onClick={() =>
            download(
              renderLayers(width, height, [layer.strokes], {
                scale: 1,
              }).toDataURL('image/png'),
              `foolscap-${seed}-slot-${layer.slotIndex}.png`,
            )
          }
        >
          Save
        </button>
      </figcaption>
      <div className="card-report">
        <ReportButton canvasId={canvasId} layerId={layer.id} />
      </div>
    </figure>
  )
}
