import type { Stroke } from '../engine/types'
import type { ReplayLayer } from '../ui/Replay'
import { LEDGER_ENABLED } from '../lib/supabase'
import {
  CANVAS_H,
  CANVAS_W,
  MASTER_PALETTE,
  SLOTS_PER_CANVAS,
  TURN_MS,
} from '../config'
import { pickSeed, saveSignature } from '../store'
import {
  cachedSignatureId,
  claimTurn,
  ensureSignature,
  fetchCanvas,
  fetchLayers,
  inheritedPalette,
  releaseTurn,
  submitTurn,
} from './ledger'

export interface CanvasState {
  canvasId: string | null
  seed: string
  /** The sheet this canvas was opened at, not the current default. */
  width: number
  height: number
  /** The slot this player is about to fill, 1-based. */
  slot: number
  /**
   * The slot just submitted, for the review screen. In ledger mode this is the
   * index the database reserved at claim time, not one the client guessed.
   */
  justFilledSlot: number | null
  priorLayers: Stroke[][]
  replayLayers: ReplayLayer[]
  palette: string[]
  closed: boolean
  /** The live turn, if one is held. */
  turnId: string | null
  /** Epoch ms the turn runs out, or null when no clock is running. */
  expiresAt: number | null
}

export interface Session {
  readonly mode: 'local' | 'ledger'
  registerSignature(strokes: Stroke[]): Promise<void>
  hasSignature(): boolean
  join(): Promise<CanvasState>
  submit(layer: Stroke[]): Promise<CanvasState>
  nextCanvas(): Promise<CanvasState>
  /** Hands the slot back rather than making the canvas wait out the clock. */
  abandon(): Promise<void>
}

function paletteFor(layers: Stroke[][], seed: string): string[] {
  const used = layers.flat().map((s) => s.color)
  return inheritedPalette(used, MASTER_PALETTE, seed)
}

/**
 * No backend: the twelve-slot relay is faked in the browser so the surface and
 * the turn clock can be exercised without a database. Deliberately the wrong
 * social model — in particular it lets one person fill every slot, which the
 * real ledger forbids.
 */
class LocalSession implements Session {
  readonly mode = 'local' as const
  private seed = pickSeed()
  private layers: Stroke[][] = []
  private expiresAt: number | null = null

  hasSignature(): boolean {
    return Boolean(localStorage.getItem('longhand.signature.v1'))
  }

  async registerSignature(strokes: Stroke[]): Promise<void> {
    saveSignature(strokes)
  }

  async join(): Promise<CanvasState> {
    this.expiresAt = Date.now() + TURN_MS
    return this.state()
  }

  async submit(layer: Stroke[]): Promise<CanvasState> {
    this.layers = [...this.layers, layer]
    this.expiresAt = null
    return this.state(this.layers.length)
  }

  async nextCanvas(): Promise<CanvasState> {
    this.seed = pickSeed()
    this.layers = []
    return this.join()
  }

  async abandon(): Promise<void> {
    this.expiresAt = null
  }

  private state(justFilledSlot: number | null = null): CanvasState {
    return {
      canvasId: null,
      seed: this.seed,
      width: CANVAS_W,
      height: CANVAS_H,
      slot: Math.min(this.layers.length + 1, SLOTS_PER_CANVAS),
      justFilledSlot,
      priorLayers: this.layers,
      replayLayers: this.layers.map((strokes, i) => ({
        slotIndex: i + 1,
        strokes,
      })),
      palette: paletteFor(this.layers, this.seed),
      closed: this.layers.length >= SLOTS_PER_CANVAS,
      turnId: null,
      expiresAt: this.expiresAt,
    }
  }
}

class LedgerSession implements Session {
  readonly mode = 'ledger' as const
  private turnId: string | null = null

  hasSignature(): boolean {
    return Boolean(cachedSignatureId())
  }

  async registerSignature(strokes: Stroke[]): Promise<void> {
    saveSignature(strokes) // keep a local copy for the "signed" card
    await ensureSignature(strokes)
  }

  /**
   * Claims a slot. The database decides which canvas and which slot, and hands
   * back an unfinished turn rather than a new one if this browser already holds
   * one — so a reload does not cost a slot.
   */
  async join(): Promise<CanvasState> {
    const signatureId = cachedSignatureId()
    if (!signatureId) throw new Error('no signature registered for this browser')

    const { turn, canvas } = await claimTurn(signatureId)
    this.turnId = turn.id

    const layers = await fetchLayers(canvas.id)
    return {
      canvasId: canvas.id,
      seed: canvas.seed_word,
      width: canvas.width ?? CANVAS_W,
      height: canvas.height ?? CANVAS_H,
      slot: turn.slot_index,
      justFilledSlot: null,
      priorLayers: layers.map((l) => l.strokes),
      replayLayers: layers.map((l) => ({
        slotIndex: l.slotIndex,
        strokes: l.strokes,
      })),
      // Fixed at claim time, server-side, so it cannot shift mid-turn.
      palette: turn.palette?.length ? turn.palette : [...MASTER_PALETTE],
      closed: false,
      turnId: turn.id,
      expiresAt: Date.parse(turn.expires_at),
    }
  }

  async submit(layer: Stroke[]): Promise<CanvasState> {
    if (!this.turnId) throw new Error('no turn is open')
    const { layer: row, canvas } = await submitTurn(this.turnId, layer)
    this.turnId = null

    const layers = await fetchLayers(canvas.id)
    return {
      canvasId: canvas.id,
      seed: canvas.seed_word,
      width: canvas.width ?? CANVAS_W,
      height: canvas.height ?? CANVAS_H,
      slot: Math.min(layers.length + 1, canvas.slot_count),
      justFilledSlot: row.slot_index,
      priorLayers: layers.map((l) => l.strokes),
      replayLayers: layers.map((l) => ({
        slotIndex: l.slotIndex,
        strokes: l.strokes,
      })),
      palette: canvas.palette ?? [],
      closed: canvas.status === 'closed',
      turnId: null,
      expiresAt: null,
    }
  }

  /**
   * There is no "next slot on this canvas" — one hand per canvas is the whole
   * premise, so drawing again means being sent somewhere else.
   */
  async nextCanvas(): Promise<CanvasState> {
    this.turnId = null
    return this.join()
  }

  async abandon(): Promise<void> {
    const id = this.turnId
    this.turnId = null
    if (id) await releaseTurn(id)
  }
}

export function createSession(): Session {
  return LEDGER_ENABLED ? new LedgerSession() : new LocalSession()
}

/** Used by the shareable canvas page, which has no session and no turn. */
export async function loadCanvasForViewing(canvasId: string): Promise<{
  seed: string
  width: number
  height: number
  closed: boolean
  slotCount: number
  closedAt: string | null
  layers: ReplayLayer[]
} | null> {
  const canvas = await fetchCanvas(canvasId)
  if (!canvas) return null
  const layers = await fetchLayers(canvasId)
  return {
    seed: canvas.seed_word,
    width: canvas.width ?? CANVAS_W,
    height: canvas.height ?? CANVAS_H,
    closed: canvas.status === 'closed',
    slotCount: canvas.slot_count,
    closedAt: canvas.closed_at,
    layers: layers.map((l) => ({ slotIndex: l.slotIndex, strokes: l.strokes })),
  }
}
