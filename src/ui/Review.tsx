import { useMemo } from 'react'
import type { Stroke } from '../engine/types'
import { renderLayers } from '../engine/render'
import { countPoints, decodeLayer, encodeLayer } from '../engine/codec'
import {
  SIGNATURE_H,
  SIGNATURE_W,
  SLOTS_PER_CANVAS,
} from '../config'
import type { StoredSignature } from '../store'
import type { CanvasState } from '../data/session'
import { Replay } from './Replay'

interface Props {
  canvas: CanvasState
  layer: Stroke[]
  signature: StoredSignature | null
  mode: 'local' | 'ledger'
  onNext: () => void
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

  const bytes = useMemo(
    () => new Blob([JSON.stringify(encoded)]).size,
    [encoded],
  )
  const ink = layer.reduce((n, s) => n + s.ink, 0)
  const slot = canvas.justFilledSlot ?? canvas.slot

  const download = () => {
    const blob = new Blob([JSON.stringify(encoded)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `longhand-layer-${slot}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="panel">
      <h1>{canvas.closed ? 'This canvas is closed' : 'Locked'}</h1>
      <p>
        {canvas.closed
          ? `Twelve hands, one sheet. “${canvas.seed}” is finished and can never be changed.`
          : `Slot ${slot} of ${SLOTS_PER_CANVAS} on “${canvas.seed}”. Nothing you drew can be removed by anyone who comes after you.`}
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

        <div className="review-caption">Ledger</div>
        <div className="stat">
          {layer.length} {layer.length === 1 ? 'stroke' : 'strokes'} ·{' '}
          {countPoints(roundTripped)} points ·{' '}
          {Math.round(ink)} px of ink · {(bytes / 1024).toFixed(1)} KB encoded
        </div>
        <div className="stat">
          {mode === 'ledger'
            ? 'Written to the ledger. Append-only — it can be hidden, never deleted.'
            : 'Local mode: nothing was persisted. Set the Supabase env vars to write to the ledger.'}
        </div>
        <div className="row">
          {canvas.canvasId && (
            <a className="linkbtn" href={`/c/${canvas.canvasId}`}>
              Its own page
            </a>
          )}
          <button className="linkbtn" onClick={download}>
            Download layer JSON
          </button>
        </div>
      </div>

      <div className="row">
        {mode === 'ledger' && (
          <a className="linkbtn" href="/gallery">
            Gallery
          </a>
        )}
        <div className="spacer" />
        <button className="linkbtn solid" onClick={onNext}>
          {/* One hand per canvas is the premise, so drawing again means being
              sent to a different sheet — not back to this one. */}
          {mode === 'ledger' ? 'Draw on another canvas' : 'Take the next slot'}
        </button>
      </div>
    </div>
  )
}
