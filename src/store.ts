import type { Stroke } from './engine/types'
import { decodeLayer, encodeLayer, type EncodedLayer } from './engine/codec'
import { SIGNATURE_H, SIGNATURE_W } from './config'

const KEY = 'longhand.signature.v1'

export interface StoredSignature {
  strokes: Stroke[]
  createdAt: number
}

/**
 * Milestone 1 keeps the mark on the device. Milestone 2 mirrors the same
 * encoded blob into `signatures.stroke_data` — identity is a drawn signature,
 * never a username, so this is the whole of a player's identity.
 */
export function loadSignature(): StoredSignature | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { layer: EncodedLayer; createdAt: number }
    if (!parsed?.layer?.strokes) return null
    return { strokes: decodeLayer(parsed.layer), createdAt: parsed.createdAt }
  } catch {
    return null
  }
}

export function saveSignature(strokes: Stroke[]): void {
  const payload = {
    layer: encodeLayer(strokes, SIGNATURE_W, SIGNATURE_H),
    createdAt: Date.now(),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* private mode — the turn still works, the mark just won't persist */
  }
}

export function clearSignature(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

const SEEDS = [
  'harbour',
  'orchard',
  'migration',
  'the long way home',
  'weather',
  'a room at night',
  'threshold',
  'low tide',
  'signal',
  'archive',
]

/** Stand-in for the server assigning a seed on canvas creation. */
export function pickSeed(): string {
  return SEEDS[Math.floor(Math.random() * SEEDS.length)]
}
