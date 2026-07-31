import type { Stroke } from '../engine/types'
import type { ReplayLayer } from '../ui/Replay'
import { LEDGER_ENABLED } from '../lib/supabase'
import { MASTER_PALETTE, SLOTS_PER_CANVAS } from '../config'
import { pickSeed, saveSignature } from '../store'
import {
  cachedSignatureId,
  ensureSignature,
  fetchCanvas,
  fetchLayers,
  inheritedPalette,
  openOrJoinCanvas,
  submitLayer,
} from './ledger'

export interface CanvasState {
  canvasId: string | null
  seed: string
  /** The slot this player is about to fill, 1-based. */
  slot: number
  /**
   * The slot just submitted, for the review screen. In ledger mode this is the
   * index the database assigned under a row lock, not one the client guessed —
   * someone else may have taken a slot while this turn was open.
   */
  justFilledSlot: number | null
  priorLayers: Stroke[][]
  replayLayers: ReplayLayer[]
  palette: string[]
  closed: boolean
}

export interface Session {
  readonly mode: 'local' | 'ledger'
  registerSignature(strokes: Stroke[]): Promise<void>
  hasSignature(): boolean
  join(): Promise<CanvasState>
  submit(layer: Stroke[]): Promise<CanvasState>
  nextCanvas(): Promise<CanvasState>
}

const CANVAS_KEY = 'longhand.canvas.v1'

function paletteFor(layers: Stroke[][], seed: string): string[] {
  const used = layers.flat().map((s) => s.color)
  return inheritedPalette(used, MASTER_PALETTE, seed)
}

/**
 * No backend: the twelve-slot relay is faked in the browser so the surface can
 * be tested without a database. Deliberately the wrong social model — it exists
 * to exercise the rendering path, not to be played.
 */
class LocalSession implements Session {
  readonly mode = 'local' as const
  private seed = pickSeed()
  private layers: Stroke[][] = []

  hasSignature(): boolean {
    return Boolean(localStorage.getItem('longhand.signature.v1'))
  }

  async registerSignature(strokes: Stroke[]): Promise<void> {
    saveSignature(strokes)
  }

  async join(): Promise<CanvasState> {
    return this.state()
  }

  async submit(layer: Stroke[]): Promise<CanvasState> {
    this.layers = [...this.layers, layer]
    return this.state(this.layers.length)
  }

  async nextCanvas(): Promise<CanvasState> {
    this.seed = pickSeed()
    this.layers = []
    return this.state()
  }

  private state(justFilledSlot: number | null = null): CanvasState {
    return {
      canvasId: null,
      seed: this.seed,
      slot: Math.min(this.layers.length + 1, SLOTS_PER_CANVAS),
      justFilledSlot,
      priorLayers: this.layers,
      replayLayers: this.layers.map((strokes, i) => ({
        slotIndex: i + 1,
        strokes,
      })),
      palette: paletteFor(this.layers, this.seed),
      closed: this.layers.length >= SLOTS_PER_CANVAS,
    }
  }
}

class LedgerSession implements Session {
  readonly mode = 'ledger' as const
  private canvasId: string | null = localStorage.getItem(CANVAS_KEY)

  hasSignature(): boolean {
    return Boolean(cachedSignatureId())
  }

  async registerSignature(strokes: Stroke[]): Promise<void> {
    saveSignature(strokes) // keep a local copy for the "signed" card
    await ensureSignature(strokes)
  }

  async join(): Promise<CanvasState> {
    const canvas = await openOrJoinCanvas()
    this.canvasId = canvas.id
    localStorage.setItem(CANVAS_KEY, canvas.id)
    return this.hydrate(canvas.id, canvas.seed_word, canvas.slot_count)
  }

  async submit(layer: Stroke[]): Promise<CanvasState> {
    const signatureId = cachedSignatureId()
    if (!signatureId) throw new Error('no signature registered for this browser')
    if (!this.canvasId) throw new Error('no canvas joined')

    const row = await submitLayer(this.canvasId, signatureId, layer)
    // Re-read rather than assume: the slot index is assigned by the database,
    // and someone else may have filled a slot while this turn was open.
    return this.hydrate(this.canvasId, undefined, SLOTS_PER_CANVAS, row.slot_index)
  }

  async nextCanvas(): Promise<CanvasState> {
    localStorage.removeItem(CANVAS_KEY)
    this.canvasId = null
    return this.join()
  }

  private async hydrate(
    canvasId: string,
    seed?: string,
    slotCount = SLOTS_PER_CANVAS,
    justFilledSlot: number | null = null,
  ): Promise<CanvasState> {
    const layers = await fetchLayers(canvasId)
    const priorLayers = layers.map((l) => l.strokes)
    const seedWord = seed ?? (await this.seedFor(canvasId))
    return {
      canvasId,
      seed: seedWord,
      slot: Math.min(layers.length + 1, slotCount),
      justFilledSlot,
      priorLayers,
      replayLayers: layers.map((l) => ({
        slotIndex: l.slotIndex,
        strokes: l.strokes,
      })),
      palette: paletteFor(priorLayers, canvasId),
      closed: layers.length >= slotCount,
    }
  }

  private async seedFor(canvasId: string): Promise<string> {
    const c = await fetchCanvas(canvasId)
    return c?.seed_word ?? 'untitled'
  }
}

export function createSession(): Session {
  return LEDGER_ENABLED ? new LedgerSession() : new LocalSession()
}
