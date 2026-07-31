import { useMemo } from 'react'
import type { Stroke } from '../engine/types'
import { renderLayers } from '../engine/render'
import { countPoints, decodeLayer, encodeLayer } from '../engine/codec'
import {
  CANVAS_H,
  CANVAS_W,
  SIGNATURE_H,
  SIGNATURE_W,
  SLOTS_PER_CANVAS,
} from '../config'
import type { StoredSignature } from '../store'

interface Props {
  seed: string
  slot: number
  priorLayers: Stroke[][]
  layer: Stroke[]
  signature: StoredSignature | null
  onNext: () => void
}

export function Review({
  seed,
  slot,
  priorLayers,
  layer,
  signature,
  onNext,
}: Props) {
  // Round-trip through the wire format rather than rendering the in-memory
  // strokes: if the encoder loses anything, this is where it shows up, not in
  // the gallery two milestones from now.
  const encoded = useMemo(
    () => encodeLayer(layer, CANVAS_W, CANVAS_H),
    [layer],
  )
  const roundTripped = useMemo(() => decodeLayer(encoded), [encoded])

  const mine = useMemo(
    () =>
      renderLayers(CANVAS_W, CANVAS_H, [roundTripped], { scale: 0.5 }).toDataURL(
        'image/png',
      ),
    [roundTripped],
  )
  const full = useMemo(
    () =>
      renderLayers(CANVAS_W, CANVAS_H, [...priorLayers, roundTripped], {
        scale: 0.5,
      }).toDataURL('image/png'),
    [priorLayers, roundTripped],
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
  const closed = slot >= SLOTS_PER_CANVAS

  const download = () => {
    const blob = new Blob([JSON.stringify(encoded, null, 0)], {
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
      <h1>{closed ? 'This canvas is closed' : 'Locked'}</h1>
      <p>
        {closed
          ? `Twelve hands, one sheet. "${seed}" is finished and can never be changed.`
          : `Slot ${slot} of ${SLOTS_PER_CANVAS} on "${seed}". Nothing you drew can be removed by anyone who comes after you.`}
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
        <img className="review-art" src={full} alt="The full canvas" />

        <div className="review-caption">Ledger</div>
        <div className="stat">
          {layer.length} strokes · {countPoints(roundTripped)} points ·{' '}
          {Math.round(ink)} px of ink · {(bytes / 1024).toFixed(1)} KB encoded
        </div>
        <div className="row">
          <button className="linkbtn" onClick={download}>
            Download layer JSON
          </button>
        </div>
      </div>

      <div className="row">
        <div className="spacer" />
        <button className="linkbtn solid" onClick={onNext}>
          {closed ? 'Start a new canvas' : 'Take the next slot'}
        </button>
      </div>
    </div>
  )
}
