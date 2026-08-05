#!/usr/bin/env node
/**
 * Bakes the clip on the welcome screen.
 *
 *   node scripts/make-welcome.mjs
 *
 * The first thing a stranger sees is a finished canvas assembling itself, and
 * it has to be there on the first frame of the first visit — before any
 * network round trip, before there is a ledger to read from, and in the
 * credential-free local mode too. So it ships as a file rather than being
 * fetched: the same twelve hands from `scene.mjs` that seed a real canvas,
 * encoded in exactly the `layers.strokes` wire format, replayed by exactly the
 * timelapse walk the rest of the app uses.
 *
 * Using the newest closed canvas from the archive instead was the obvious
 * alternative and is wrong twice over — it is empty on launch day, which is
 * the only day this screen really matters, and it would put whatever a
 * stranger drew last night in front of the next stranger with nothing between
 * the two but hope.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { H, SEED_WORD, W, encode, scene } from './scene.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'public', 'welcome-canvas.json')

const layers = scene()

const doc = {
  v: 1,
  seed: SEED_WORD,
  w: W,
  h: H,
  layers: layers.map((strokes) => encode(strokes, W, H)),
}

// Point coordinates are already rounded to 0.1 by the scene, so this is only
// about the ones JSON would otherwise print as 1465.7000000000003.
const json = JSON.stringify(doc, (_, v) =>
  typeof v === 'number' ? Math.round(v * 100) / 100 : v,
)

writeFileSync(out, json)

const strokes = layers.flat().length
const points = layers.flat().reduce((n, s) => n + s.pts.length, 0)
console.log(`public/welcome-canvas.json`)
console.log(
  `  ${layers.length} hands · ${strokes} strokes · ${points} points · ` +
    `${(json.length / 1024).toFixed(1)} KB`,
)
