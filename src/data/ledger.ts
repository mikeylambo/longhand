import { requireSupabase } from '../lib/supabase'
import { decodeLayer, encodeLayer, type EncodedLayer } from '../engine/codec'
import type { Stroke } from '../engine/types'
import {
  CANVAS_H,
  CANVAS_W,
  PALETTE_MIN,
  PALETTE_NEW_PER_SLOT,
  SIGNATURE_H,
  SIGNATURE_W,
  SLOTS_PER_CANVAS,
} from '../config'

export interface CanvasRow {
  id: string
  seed_word: string
  slot_count: number
  slots_filled: number
  status: 'open' | 'in_turn' | 'closed'
  palette: string[]
  /** The sheet this canvas was opened at. Never read a constant instead —
   *  changing the default would reflow everything already in the archive. */
  width: number
  height: number
  /** Whether it appears in the gallery. Unlisted canvases stay reachable at
   *  their own URL — this is curation, not moderation. */
  listed: boolean
  created_at: string
  closed_at: string | null
}

export interface LayerRow {
  id: string
  canvas_id: string
  slot_index: number
  signature_id: string
  strokes: EncodedLayer
  ink_used: number
  hidden: boolean
  submitted_at: string
}

/** A layer decoded for rendering, with the identity that drew it. */
export interface LedgerLayer {
  id: string
  slotIndex: number
  signatureId: string
  strokes: Stroke[]
  inkUsed: number
  submittedAt: string
}

const DEVICE_KEY = 'longhand.device.v1'
const SIGNATURE_ID_KEY = 'longhand.signature-id.v1'

/**
 * A random id this browser keeps, so a returning player is recognised as the
 * same hand. Deliberately generated, not derived — nothing about the device or
 * the person is measured or sent.
 */
export function deviceKey(): string {
  let k = localStorage.getItem(DEVICE_KEY)
  if (!k) {
    k = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, k)
  }
  return k
}

/**
 * Writes the drawn mark once and remembers its id. The signature is the
 * player's entire identity, so this runs before any turn can be taken.
 */
export async function ensureSignature(strokes: Stroke[]): Promise<string> {
  const cached = localStorage.getItem(SIGNATURE_ID_KEY)
  if (cached) return cached

  const db = requireSupabase()
  const { data, error } = await db
    .from('signatures')
    .insert({
      stroke_data: encodeLayer(strokes, SIGNATURE_W, SIGNATURE_H),
      device_key: deviceKey(),
    })
    .select('id')
    .single()

  if (error) throw new Error(`could not save your mark: ${error.message}`)
  localStorage.setItem(SIGNATURE_ID_KEY, data.id)
  return data.id as string
}

export function cachedSignatureId(): string | null {
  return localStorage.getItem(SIGNATURE_ID_KEY)
}

export interface TurnRow {
  id: string
  canvas_id: string
  slot_index: number
  signature_id: string
  claimed_at: string
  expires_at: string
  state: 'active' | 'submitted' | 'expired'
  palette: string[]
}

export interface ClaimResult {
  turn: TurnRow
  canvas: CanvasRow
  /** True when an unfinished turn was handed back rather than a new one taken. */
  resumed: boolean
}

/**
 * Reserves a slot and starts the clock.
 *
 * Reloading mid-turn must not cost a slot, so the database returns an existing
 * live turn instead of claiming a second — `resumed` says which happened. The
 * palette is fixed at claim time and travels on the turn, so it cannot shift
 * under a player who is halfway through drawing.
 *
 * `slots` asks for a format. Left off, the database picks the canvas closest
 * to closing, which is what a stranger should get: the best odds that the hand
 * they are about to add is the one that finishes something.
 */
export async function claimTurn(
  signatureId: string,
  slots?: number,
): Promise<ClaimResult> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('claim_turn', {
    p_signature: signatureId,
    p_device_key: deviceKey(),
    ...(slots ? { p_slots: slots } : {}),
  })
  if (error) throw new Error(`could not find you a slot: ${error.message}`)
  return data as ClaimResult
}

export interface FormatRow {
  slot_count: number
  label: string
  weight: number
}

/** The sizes a canvas may be opened at. The table is the authority, not the
 *  client's names for them. */
export async function fetchFormats(): Promise<FormatRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('canvas_formats')
    .select('slot_count, label, weight')
    .order('slot_count', { ascending: true })
  if (error) throw new Error(`could not load the formats: ${error.message}`)
  return (data ?? []) as FormatRow[]
}

/**
 * One tap. There is no form, no category and no text field — the drawing is
 * the only channel this product has, and a reason box would be a message box
 * wearing a different name.
 *
 * The server collapses a second tap from the same browser and drops a flood
 * without saying so, so this resolves the same way whatever happened to it.
 * The only thing a reporter is told is that it was received.
 */
export async function reportContent(
  canvasId: string,
  layerId: string | null = null,
): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('report_content', {
    p_canvas: canvasId,
    p_layer: layerId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`that report did not send: ${error.message}`)
}

/** Hands a slot back early rather than making the canvas wait out the timer. */
export async function releaseTurn(turnId: string): Promise<boolean> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('release_turn', {
    p_turn: turnId,
    p_device_key: deviceKey(),
  })
  if (error) return false
  return Boolean(data)
}

export async function fetchCanvas(id: string): Promise<CanvasRow | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('canvases')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`could not load the canvas: ${error.message}`)
  return (data as CanvasRow | null) ?? null
}

/**
 * Hidden layers are filtered out by RLS, not by this query — they still exist
 * in the table, they just stop being served.
 */
export async function fetchLayers(canvasId: string): Promise<LedgerLayer[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('layers')
    .select('*')
    .eq('canvas_id', canvasId)
    .order('slot_index', { ascending: true })

  if (error) throw new Error(`could not load the canvas: ${error.message}`)
  return (data as LayerRow[]).map((row) => ({
    id: row.id,
    slotIndex: row.slot_index,
    signatureId: row.signature_id,
    strokes: decodeLayer(row.strokes),
    inkUsed: row.ink_used,
    submittedAt: row.submitted_at,
  }))
}

export async function fetchSignatures(
  ids: string[],
): Promise<Map<string, Stroke[]>> {
  const out = new Map<string, Stroke[]>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return out

  const db = requireSupabase()
  const { data, error } = await db
    .from('signatures')
    .select('id, stroke_data')
    .in('id', unique)
  if (error) throw new Error(`could not load signatures: ${error.message}`)

  for (const row of data as { id: string; stroke_data: EncodedLayer }[]) {
    out.set(row.id, decodeLayer(row.stroke_data))
  }
  return out
}

/**
 * Submit-and-lock. A layer can only be written against a live turn, at the slot
 * that turn reserved — so the slot index is never chosen here. Authorship is
 * proved by the device key that created the signature; that column is not
 * readable by clients, so a layer cannot be attributed to someone else's mark.
 */
export async function submitTurn(
  turnId: string,
  strokes: Stroke[],
): Promise<{ layer: LayerRow; canvas: CanvasRow }> {
  const db = requireSupabase()
  const ink = Math.round(strokes.reduce((n, s) => n + s.ink, 0))
  const { data, error } = await db.rpc('submit_turn', {
    p_turn: turnId,
    p_strokes: encodeLayer(strokes, CANVAS_W, CANVAS_H),
    p_ink: ink,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`your layer was not saved: ${error.message}`)
  return data as { layer: LayerRow; canvas: CanvasRow }
}

/**
 * What the next arrival would most likely join, for the line on the welcome
 * screen that says something is already underway.
 *
 * A preview, not a promise: it reads the oldest open canvases and picks the
 * one closest to closing the same way `claim_turn` does, but without the lock
 * or the live-turn predicate, because the answer is a sentence rather than a
 * slot. By the time anyone signs and claims, it may well be a different sheet.
 */
export async function fetchCanvasInProgress(): Promise<CanvasRow | null> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('canvases')
    .select('*')
    .neq('status', 'closed')
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) return null
  const open = ((data ?? []) as CanvasRow[]).filter(
    (c) => c.slots_filled > 0 && c.slots_filled < c.slot_count,
  )
  if (open.length === 0) return null
  return open.reduce((best, c) =>
    c.slot_count - c.slots_filled < best.slot_count - best.slots_filled ? c : best,
  )
}

/**
 * Closed, listed canvases, newest first — the gallery.
 *
 * Unlisted ones are filtered here rather than removed anywhere: they keep their
 * URL, their timelapse and their cards, and everyone who drew on one still sees
 * exactly what they saw before. Nothing leaves the ledger.
 */
export async function fetchClosedCanvases(limit = 40): Promise<CanvasRow[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('canvases')
    .select('*')
    .eq('status', 'closed')
    .eq('listed', true)
    .order('closed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`could not load the gallery: ${error.message}`)
  return (data ?? []) as CanvasRow[]
}

/**
 * Palette inheritance: every colour already on the canvas, plus two more from
 * the master palette. Slot 1 gets a free hand. This is the highest-leverage
 * cohesion mechanic in the design — twelve strangers sharing a drifting palette
 * produce something that looks like one picture.
 */
export function inheritedPalette(
  used: string[],
  master: readonly string[],
  seed = '',
  extra = PALETTE_NEW_PER_SLOT,
  floor = PALETTE_MIN,
): string[] {
  if (used.length === 0) return [...master]
  const have = new Set(used.filter((c) => master.includes(c)))
  const unused = master.filter((c) => !have.has(c))
  if (unused.length === 0) return [...master]

  // How many new colours to offer. Normally `extra`, but topped up so a canvas
  // opened in a single colour doesn't hand the next player a three-swatch box.
  const want = Math.max(extra, floor - have.size)
  const take = Math.min(want, unused.length)

  // Offset by the canvas id so two canvases that happen to share a palette
  // still drift in different directions.
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  const start = Math.abs(h) % unused.length
  const fresh = new Set(
    Array.from({ length: take }, (_, i) => unused[(start + i) % unused.length]),
  )
  return master.filter((c) => have.has(c) || fresh.has(c))
}

export const isCanvasFull = (c: CanvasRow) =>
  c.slots_filled >= (c.slot_count ?? SLOTS_PER_CANVAS)
