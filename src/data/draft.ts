import { decodeLayer, encodeLayer, type EncodedLayer } from '../engine/codec'
import type { Stroke } from '../engine/types'

/**
 * A turn in progress, kept where a reload cannot reach it.
 *
 * Until this existed, strokes lived only in the surface's memory and nothing
 * wrote them anywhere until submit. Reloading resumed the turn — same slot,
 * same clock — with an empty sheet. Expiry at least announces itself; this
 * did not, and on a phone it does not take a deliberate reload: iOS discards
 * backgrounded tabs, so a phone call eight minutes into a turn took the
 * drawing with it, at the moment it was worth the most.
 *
 * Three things this deliberately is not.
 *
 * It is not the ledger. Nothing here is sent anywhere, nothing here is a
 * layer, and a draft has no bearing on when work becomes real — that is still
 * submit, and only submit. This is a scratchpad that survives a refresh.
 *
 * It is not a second format. Drafts are stored through the same codec a layer
 * is submitted through, so what comes back is exactly what would have been
 * sent, down to the rounded ink. A draft that restored more faithfully than
 * submit would be a lie about what you had.
 *
 * It is not a history. One draft exists at a time, because one turn is held at
 * a time. Two tabs on two canvases would overwrite each other's draft — the
 * turn key means the survivor is still restored to the right turn and the
 * other simply does not come back, which is the behaviour it had before this
 * existed rather than a regression.
 */

const KEY = 'longhand.draft.v1'

export interface TurnRef {
  canvasId: string | null
  slot: number
  /** Part of the identity, not decoration: if this slot is claimed again after
   *  expiring it is a different turn, and last week's drawing should not
   *  reappear underneath somebody starting fresh. */
  expiresAt: number | null
}

interface Draft {
  turn: string
  savedAt: number
  layer: EncodedLayer
}

const turnKey = (t: TurnRef) => `${t.canvasId ?? 'local'}#${t.slot}#${t.expiresAt ?? 0}`

export function saveDraft(
  turn: TurnRef,
  strokes: Stroke[],
  width: number,
  height: number,
): void {
  try {
    if (strokes.length === 0) {
      clearDraft()
      return
    }
    const draft: Draft = {
      turn: turnKey(turn),
      savedAt: Date.now(),
      layer: encodeLayer(strokes, width, height),
    }
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Quota exceeded, private mode, storage disabled. Failing to keep a draft
    // leaves things exactly as they were before drafts existed, so it is not
    // worth interrupting somebody mid-drawing to say so.
  }
}

export function loadDraft(
  turn: TurnRef,
  width: number,
  height: number,
): Stroke[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Draft
    if (draft?.turn !== turnKey(turn)) return null
    // A sheet of a different size would restore strokes at coordinates that
    // mean something else. Canvases carry their own dimensions, so this is
    // possible and silent if not checked.
    if (draft.layer?.w !== width || draft.layer?.h !== height) return null
    const strokes = decodeLayer(draft.layer)
    return strokes.length > 0 ? strokes : null
  } catch {
    // Anything unreadable is treated as absent. A corrupt draft must never be
    // the reason somebody cannot start drawing.
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do and nothing worth saying */
  }
}
