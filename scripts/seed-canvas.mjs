#!/usr/bin/env node
/**
 * Seeds one finished canvas so the closed-canvas page, the timelapse and the
 * per-hand cards can be reviewed before twelve real strangers exist.
 *
 * It goes through the real endpoints — twelve distinct signatures, each
 * claiming a turn and submitting against it — so what lands in the ledger is
 * shaped exactly like player data, not hand-written rows. The only thing it
 * fakes is the hands.
 *
 *   node scripts/seed-canvas.mjs
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from .env.local.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
// Environment wins over .env.local, so the same script can seed a local stack
// for a restore drill without being pointed at production by default.
const URL_BASE = process.env.SEED_SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.SEED_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!URL_BASE || !KEY) throw new Error('missing Supabase credentials in .env.local')

// The scene itself lives in scene.mjs, because the welcome clip is baked from
// exactly these twelve hands and the two must not drift.
const { W, H, INK_BUDGET, LAYERS, mulberry32, signatureStrokes, encode, inGamut } =
  await import('./scene.mjs')

async function legalColours() {
  const res = await fetch(`${URL_BASE}/rest/v1/palette_colors?select=hex`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`palette: ${await res.text()}`)
  return new Set((await res.json()).map((r) => r.hex.toUpperCase()))
}

function assertDrawable(strokes, palette, slot) {
  for (const st of strokes) {
    const hex = st.color.toUpperCase()
    if (!palette.has(hex) && !inGamut(hex)) {
      throw new Error(`slot ${slot}: ${hex} is neither a palette colour nor in gamut`)
    }
  }
}

// -------------------------------------------------------------------- wire

async function rpc(fn, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn}: ${text}`)
  return JSON.parse(text)
}

async function createSignature(strokes, deviceKey) {
  // `?select=id` matters: anon has no SELECT on device_key, so asking for the
  // whole row back is denied. Same rule the app client follows.
  const res = await fetch(`${URL_BASE}/rest/v1/signatures?select=id`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      stroke_data: encode(strokes, 900, 340),
      device_key: deviceKey,
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`signature: ${text}`)
  return JSON.parse(text)[0].id
}

// -------------------------------------------------------------------- main

const PALETTE = await legalColours()
console.log(`ledger offers ${PALETTE.size} colours, plus any hue inside the gamut`)

const hands = []
for (let i = 0; i < 12; i++) {
  const deviceKey = `seed-hand-${String(i + 1).padStart(2, '0')}-${Date.now().toString(36)}`
  const id = await createSignature(signatureStrokes(0xbeef + i * 977), deviceKey)
  hands.push({ id, deviceKey })
}
console.log(`created ${hands.length} signatures`)

// Claim every slot first, then submit the layer designed for the slot the
// database actually handed out — never the one this script assumed.
const claims = []
for (const hand of hands) {
  // Asking for a twelve explicitly. Without it the ledger sends each hand to
  // whatever is closest to closing, which is right for a player and wrong for
  // a seed — the twelve fixture layers are one scene and belong on one sheet.
  const { turn, canvas } = await rpc('claim_turn', {
    p_signature: hand.id,
    p_device_key: hand.deviceKey,
    p_slots: 12,
  })
  claims.push({
    ...hand,
    turnId: turn.id,
    slot: turn.slot_index,
    canvasId: canvas.id,
    palette: turn.palette,
  })
}
const canvasId = claims[0].canvasId
if (!claims.every((c) => c.canvasId === canvasId)) {
  throw new Error('claims landed on more than one canvas — truncate and retry')
}
console.log(`claimed slots ${claims.map((c) => c.slot).join(', ')} on ${canvasId}`)

let totalInk = 0
for (const claim of claims.sort((a, b) => a.slot - b.slot)) {
  const rand = mulberry32(0xc0ffee + claim.slot * 7919)
  const strokes = LAYERS[claim.slot - 1](rand)
  assertDrawable(strokes, PALETTE, claim.slot)
  const mixed = strokes.filter((s) => !PALETTE.has(s.color.toUpperCase())).length
  const tinted = strokes.filter(
    (s) => PALETTE.has(s.color.toUpperCase()) && !claim.palette.includes(s.color),
  ).length
  const ink = strokes.reduce((n, s) => n + s.ink, 0)
  totalInk += ink
  if (ink > INK_BUDGET) {
    throw new Error(`slot ${claim.slot} costs ${ink}, over the ${INK_BUDGET} budget`)
  }
  await rpc('submit_turn', {
    p_turn: claim.turnId,
    p_strokes: encode(strokes, W, H),
    p_ink: ink,
    p_device_key: claim.deviceKey,
  })
  console.log(
    `slot ${String(claim.slot).padStart(2)} — ${String(strokes.length).padStart(3)} strokes, ` +
      `${String(ink).padStart(5)} ink (${Math.round((ink / INK_BUDGET) * 100)}% of budget)` +
      (tinted ? `, ${tinted} tint/shade` : '') +
      (mixed ? `, ${mixed} mixed` : ''),
  )
}

console.log(`\ntotal ink ${totalInk} across 12 hands`)
console.log(`canvas ${canvasId}`)
console.log(`/c/${canvasId}`)
