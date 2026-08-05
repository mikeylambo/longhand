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

export interface GiftPeek {
  seed: string
  slot: number
  slot_count: number
  canvas: string
  expires_at: string
  taken: boolean
  expired: boolean
}

/** What an invitation says before anybody has signed anything. Never who sent
 *  it — a gift is between two people and the ledger is not one of them. */
export async function peekGift(token: string): Promise<GiftPeek | null> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('peek_gift', { p_token: token })
  if (error || !data) return null
  return data as GiftPeek
}

export async function giftSlot(canvasId: string): Promise<{ token: string; slot: number }> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('no signature registered for this browser')
  const db = requireSupabase()
  const { data, error } = await db.rpc('gift_slot', {
    p_canvas: canvasId,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not save a place: ${error.message}`)
  return data as { token: string; slot: number }
}

export async function redeemGiftToken(token: string): Promise<ClaimResult> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('no signature registered for this browser')
  const db = requireSupabase()
  const { data, error } = await db.rpc('redeem_gift', {
    p_token: token,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`that place is not there: ${error.message}`)
  return data as ClaimResult
}

export interface Place {
  id: string
  name: string
  country: string
  lat: number
  lon: number
}

export interface PinnedCanvas {
  canvas: CanvasRow
  place: Place
}

export async function fetchPlaces(): Promise<Place[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('places')
    .select('id, name, country, lat, lon')
    .order('name', { ascending: true })
  if (error) return []
  return (data ?? []) as Place[]
}

/**
 * Finished canvases that have a place, for the world map.
 *
 * Unlisted and classroom canvases are excluded by the same rule the gallery
 * uses, because a map is a shelf with geography on it and a canvas taken off
 * one shelf is off both.
 */
export async function fetchPinnedCanvases(limit = 300): Promise<PinnedCanvas[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('canvases')
    .select('*, places(id, name, country, lat, lon)')
    .eq('status', 'closed')
    .eq('listed', true)
    .is('classroom_id', null)
    .not('place_id', 'is', null)
    .order('closed_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`could not load the map: ${error.message}`)

  return ((data ?? []) as unknown as (CanvasRow & { places: Place | null })[])
    .filter((row) => row.places)
    .map((row) => ({ canvas: row, place: row.places! }))
}

/** Names where a canvas is, once, by the hand that opened it. */
export async function setCanvasPlace(
  canvasId: string,
  placeId: string,
): Promise<void> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('no signature registered for this browser')
  const db = requireSupabase()
  const { error } = await db.rpc('set_canvas_place', {
    p_canvas: canvasId,
    p_place: placeId,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not pin that canvas: ${error.message}`)
}

/** One canvas a hand appears on, with that hand's layer from it. */
export interface HandCanvas {
  layerId: string
  slotIndex: number
  strokes: Stroke[]
  submittedAt: string
  canvas: CanvasRow
}

/**
 * Every canvas a signature appears on.
 *
 * The identity system taken to its conclusion: the signature *is* the account,
 * so this is the whole of a profile. No bio, no follower count, no way to
 * message — a page of work and nothing else, which is the only kind of profile
 * that fits a product whose only channel is the drawing.
 *
 * Needs no new grant. `layers` and `canvases` are already readable, and RLS
 * still hides what has been hidden — so a hand's page and the canvas pages
 * agree about what exists without either of them being told to.
 */
export async function fetchHandCanvases(
  signatureId: string,
  limit = 60,
): Promise<HandCanvas[]> {
  const db = requireSupabase()
  const { data, error } = await db
    .from('layers')
    .select('id, slot_index, strokes, submitted_at, canvases(*)')
    .eq('signature_id', signatureId)
    .order('submitted_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`could not load that hand: ${error.message}`)

  return ((data ?? []) as unknown as (LayerRow & { canvases: CanvasRow })[])
    .filter((r) => r.canvases)
    .map((r) => ({
      layerId: r.id,
      slotIndex: r.slot_index,
      strokes: decodeLayer(r.strokes),
      submittedAt: r.submitted_at,
      canvas: r.canvases,
    }))
}

/**
 * Which canvases two hands have both been on.
 *
 * The most emotionally distinctive thing available here, and it is a set
 * intersection. Quiet regulars emerge out of strangers without anybody
 * following anybody — there is no follow button to add, and adding one would
 * turn a museum into a network.
 */
export async function sharedCanvasIds(
  a: string,
  b: string,
): Promise<string[]> {
  if (a === b) return []
  const db = requireSupabase()
  const { data, error } = await db
    .from('layers')
    .select('canvas_id, signature_id')
    .in('signature_id', [a, b])
  if (error) return []

  const rows = (data ?? []) as { canvas_id: string; signature_id: string }[]
  const mine = new Set(rows.filter((r) => r.signature_id === a).map((r) => r.canvas_id))
  return [
    ...new Set(
      rows.filter((r) => r.signature_id === b && mine.has(r.canvas_id)).map((r) => r.canvas_id),
    ),
  ]
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

// ------------------------------------------------------------------- prints

export interface PrintQuestion {
  request: string
  canvas: string
  seed: string
  state: 'consent' | 'ready'
  answered: 'yes' | 'no' | null
}

/**
 * Asking for a print asks everybody else too.
 *
 * The terms say a contributor can decline to be in something sold, so consent
 * is the mechanism rather than a policy: nothing is made until every hand on
 * the canvas has said yes, and one no ends it.
 */
export async function requestPrint(canvasId: string): Promise<void> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('no signature registered for this browser')
  const db = requireSupabase()
  const { error } = await db.rpc('request_print', {
    p_canvas: canvasId,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not ask about a print: ${error.message}`)
}

export async function myPrintQuestions(): Promise<PrintQuestion[]> {
  const signatureId = cachedSignatureId()
  if (!signatureId) return []
  const db = requireSupabase()
  const { data, error } = await db.rpc('my_print_questions', {
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) return []
  return (data ?? []) as PrintQuestion[]
}

export async function answerPrint(requestId: string, yes: boolean): Promise<string> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('no signature registered for this browser')
  const db = requireSupabase()
  const { data, error } = await db.rpc('answer_print', {
    p_request: requestId,
    p_signature: signatureId,
    p_device_key: deviceKey(),
    p_yes: yes,
  })
  if (error) throw new Error(`that answer did not save: ${error.message}`)
  return data as string
}

// --------------------------------------------------------------- classrooms

export interface Classroom {
  id: string
  name: string
  code: string
  canvases: {
    id: string
    seed: string
    status: string
    slots: number
    filled: number
  }[]
}

export async function openClassroom(name: string): Promise<Classroom> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('you need a mark before you can open a room')
  const db = requireSupabase()
  const { data, error } = await db.rpc('open_classroom', {
    p_name: name,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not open a room: ${error.message}`)
  return { ...(data as Classroom), canvases: [] }
}

export async function myClassrooms(): Promise<Classroom[]> {
  const signatureId = cachedSignatureId()
  if (!signatureId) return []
  const db = requireSupabase()
  const { data, error } = await db.rpc('my_classrooms', {
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) return []
  return (data ?? []) as Classroom[]
}

export async function openClassroomCanvas(
  code: string,
  slots: number,
): Promise<{ id: string }> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('you need a mark first')
  const db = requireSupabase()
  const { data, error } = await db.rpc('open_classroom_canvas', {
    p_code: code,
    p_signature: signatureId,
    p_device_key: deviceKey(),
    p_slots: slots,
  })
  if (error) throw new Error(`could not start that canvas: ${error.message}`)
  return data as { id: string }
}

export async function claimClassroomTurn(code: string): Promise<ClaimResult> {
  const signatureId = cachedSignatureId()
  if (!signatureId) throw new Error('you need a mark before you can join')
  const db = requireSupabase()
  const { data, error } = await db.rpc('claim_classroom_turn', {
    p_code: code,
    p_signature: signatureId,
    p_device_key: deviceKey(),
  })
  if (error) throw new Error(`could not join that class: ${error.message}`)
  return data as ClaimResult
}
