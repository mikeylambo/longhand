import { useState } from 'react'
import type { Stroke } from '../engine/types'
import { SLOTS_PER_CANVAS } from '../config'
import { loadSignature, pickSeed, type StoredSignature } from '../store'
import { SignaturePad } from './SignaturePad'
import { DrawTurn } from './DrawTurn'
import { Review } from './Review'

type Phase = 'signature' | 'draw' | 'review'

/**
 * Milestone 1 has no backend, so the relay is simulated locally: finishing a
 * turn pushes your layer into the prior stack and hands you the next slot. It
 * is the wrong social model on purpose — but it exercises the exact rendering
 * path a real twelve-stranger canvas will take, which is what needs proving
 * before any of the queue machinery exists.
 */
export function App() {
  const [signature, setSignature] = useState<StoredSignature | null>(() =>
    loadSignature(),
  )
  const [phase, setPhase] = useState<Phase>(() =>
    loadSignature() ? 'draw' : 'signature',
  )
  const [seed, setSeed] = useState(() => pickSeed())
  const [slot, setSlot] = useState(1)
  const [priorLayers, setPriorLayers] = useState<Stroke[][]>([])
  const [justDrawn, setJustDrawn] = useState<Stroke[]>([])

  if (phase === 'signature') {
    return (
      <SignaturePad
        onDone={() => {
          setSignature(loadSignature())
          setPhase('draw')
        }}
      />
    )
  }

  if (phase === 'review') {
    return (
      <Review
        seed={seed}
        slot={slot}
        priorLayers={priorLayers}
        layer={justDrawn}
        signature={signature}
        onNext={() => {
          if (slot >= SLOTS_PER_CANVAS) {
            setSeed(pickSeed())
            setSlot(1)
            setPriorLayers([])
          } else {
            setPriorLayers([...priorLayers, justDrawn])
            setSlot(slot + 1)
          }
          setJustDrawn([])
          setPhase('draw')
        }}
      />
    )
  }

  return (
    <DrawTurn
      key={`${seed}-${slot}`}
      seed={seed}
      slot={slot}
      priorLayers={priorLayers}
      onSubmit={(layer) => {
        setJustDrawn(layer)
        setPhase('review')
      }}
    />
  )
}
