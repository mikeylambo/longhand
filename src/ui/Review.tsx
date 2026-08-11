import { useMemo } from 'react'
import type { Stroke } from '../engine/types'
import { renderLayers } from '../engine/render'
import { countPoints, decodeLayer, encodeLayer } from '../engine/codec'
import { FORMATS, SIGNATURE_H, SIGNATURE_W, formatFor } from '../config'
import type { StoredSignature } from '../store'
import type { CanvasState } from '../data/session'
import { Replay } from './Replay'
import { Footer } from './Footer'
import { AfterTurn } from './AfterTurn'

interface Props {
  canvas: CanvasState
  layer: Stroke[]
  signature: StoredSignature | null
  mode: 'local' | 'ledger'
  /** `slots` asks for a format on the next canvas; left off, the ledger sends
   *  you wherever is closest to closing. */
  onNext: (slots?: number) => void
}

export function Review({ canvas, layer, signature, mode, onNext }: Props) {
  // Round-trip through the wire format rather than rendering the in-memory
  // strokes: if the encoder loses anything, this is where it shows up, not in
  // the gallery two milestones from now.
  const { width, height } = canvas
  const encoded = useMemo(
    () => encodeLayer(layer, width, height),
    [layer, width, height],
  )
  const roundTripped = useMemo(() => decodeLayer(encoded), [encoded])

  const mine = useMemo(
    () =>
      renderLayers(width, height, [roundTripped], {
        scale: 0.5,
      }).toDataURL('image/png'),
    [roundTripped, width, height],
  )
  const sig = useMemo(
    () =>
      signature
        ? renderLayers(SIGNATURE_W, SIGNATURE_H, [signature.strokes], {
            scale: 0.5,
          }).toDataURL('image/png')
        : null,
    [signature],
  )

  const ink = layer.reduce((n, s) => n + s.ink, 0)
  const slot = canvas.justFilledSlot ?? canvas.slot
  const format = formatFor(canvas.slotCount)
  const waiting = Math.max(0, canvas.slotCount - slot)

  const download = () => {
    const blob = new Blob([JSON.stringify(encoded)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `foolscap-layer-${slot}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel">
      <h1>{canvas.closed ? 'Canvas complete' : 'Yours is on it'}</h1>
      <p>
        {canvas.closed
          ? `“${canvas.seed}” is complete — ${format.hands} hands shared this sheet, and now it belongs to the gallery.`
          : waiting === 1
            ? `Slot ${slot} of ${canvas.slotCount} on “${canvas.seed}”. One more hand and it closes.`
            : `Slot ${slot} of ${canvas.slotCount} on “${canvas.seed}”. ${waiting} more hands and it closes. Nothing you drew can be removed by anyone who comes after you.`}
      </p>

      <div className="scroll">
        <div className="review-caption">Your layer alone</div>
        <img className="review-art" src={mine} alt="Your contribution" />

        {sig && (
          <>
            <div className="review-caption">Signed</div>
            <img className="review-art" src={sig} alt="Your mark" />
          </>
        )}

        <div className="review-caption">The canvas as it stands</div>
        <Replay
          layers={canvas.replayLayers}
          width={width}
          height={height}
        />

        <div className="review-caption">In the ledger</div>
        <div className="stat">
          {layer.length} {layer.length === 1 ? 'stroke' : 'strokes'} ·{' '}
          {countPoints(roundTripped)} points · {Math.round(ink)} pixels of ink
        </div>
        <div className="stat">
          {mode === 'ledger'
            ? 'Written and locked. This layer is permanently preserved and can never be erased.'
            : 'Local mode: nothing was persisted. Set the Supabase env vars to write to the ledger.'}
        </div>
        <div className="row">
          {canvas.canvasId && (
            <a className="linkbtn" href={`/c/${canvas.canvasId}`}>
              {canvas.closed ? 'See it finished' : 'Its own page'}
            </a>
          )}
          <button className="linkbtn quiet" onClick={download}>
            Download the layer
          </button>
        </div>
        {!canvas.closed && canvas.canvasId && (
          <p className="stat">
            That page is where it will be when the last hand lands. Turn
            notifications on from <a href="/mark">your mark</a> and you will be
            told instead of having to remember.
          </p>
        )}

        {mode === 'ledger' && canvas.canvasId && !canvas.closed && (
          <AfterTurn canvasId={canvas.canvasId} slot={slot} />
        )}
      </div>

      <div className="row">
        <div className="spacer" />
        <button className="linkbtn solid" onClick={() => onNext()}>
          {/* One hand per canvas is the premise, so drawing again means being
              sent to a different sheet — not back to this one. */}
          {mode === 'ledger' ? 'Draw on another canvas' : 'Take the next slot'}
        </button>
      </div>

      {mode === 'ledger' && (
        <>
          <p className="chooser">
            Start a new canvas:{' '}
            {FORMATS.filter((f) => !f.onRequest).map((f, i) => (
              <span key={f.slots}>
                {i > 0 && ' · '}
                <button className="asif" onClick={() => onNext(f.slots)}>
                  {f.name}
                </button>
              </span>
            ))}
          </p>
          {/* On their own line because the rotation never opens one and
              because a hundred hands is a different proposition from two —
              it will be open for a long time, which is the appeal and also
              the thing not to bury in a row of ordinary choices. */}
          <p className="chooser quiet">
            Or begin a longer journey:{' '}
            {FORMATS.filter((f) => f.onRequest).map((f, i) => (
              <span key={f.slots}>
                {i > 0 && ' · '}
                <button className="asif" onClick={() => onNext(f.slots)}>
                  {f.name}
                </button>
              </span>
            ))}
          </p>
        </>
      )}

      <Footer wander={mode === 'ledger'} />
    </div>
  )
}
