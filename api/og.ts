/**
 * The share image for a canvas — the artwork itself, rendered on the server.
 *
 * `api/canvas.ts` already rewrites the title and description of `/c/<id>` so a
 * shared link reads as the canvas it points at. This is the other half: the
 * picture. Until now every link previewed with the app icon, so a finished
 * drawing and a link to the terms page looked identical in a message.
 *
 * The one rule this had to obey is that the preview cannot be a second, subtly
 * different renderer. A canvas is a few tens of KB of stroke vectors, and the
 * app turns those into pixels through exactly one path — `decodeLayer` then
 * `drawLayers`. This calls the same two functions, against a Skia canvas
 * instead of a browser one, so the thing that scrolls past in a chat is the
 * thing the artist saw in their hand. A hand-written SVG translation would have
 * been lighter and would have drifted from the real picture the first time a
 * wash or a fill was involved; a polygon is a fact, and so is a quadratic.
 *
 * Node runtime, not edge: the rasteriser is a native module, and edge has no
 * native modules. That is the only reason this is a second function rather than
 * a branch of `api/canvas.ts`.
 *
 * Anything that is not a listed canvas with at least one hand on it falls back
 * to the app icon — the same default the static tags carried before — so a bad
 * id, a private canvas or a transient database blip still previews as *some*
 * valid image rather than a broken-image glyph.
 */

import { createCanvas } from '@napi-rs/canvas'
// Extensions on purpose. package.json is "type": "module", so Vercel runs the
// compiled api/og.js under Node's native ESM loader, which — unlike tsc, Vite
// and esbuild — refuses a relative import with no extension. Vercel transpiles
// these files rather than bundling them, so an extensionless specifier that is
// fine everywhere else reaches production and throws ERR_MODULE_NOT_FOUND at
// the first request. The compiled files are .js, so that is what is named here.
import { drawLayers } from '../src/engine/render.js'
import { decodeLayer, type EncodedLayer } from '../src/engine/codec.js'
import { PAPER, CANVAS_W, CANVAS_H } from '../src/config.js'
import type { Stroke } from '../src/engine/types.js'

export const config = { runtime: 'nodejs' }

// Vercel injects these at runtime. Declared rather than pulled in from
// @types/node, which would drag a platform's worth of globals into a file that
// wants two environment strings.
declare const process: { env: Record<string, string | undefined> }

const UUID = /^[0-9a-f-]{36}$/i

// The universal 1.91:1 that every platform accepts. A canvas is square, so it
// sits on a wider sheet — which reads as a mounted drawing rather than a
// letterbox, and happens to want no cropping and no decision about which third
// of a square to throw away.
const CARD_W = 1200
const CARD_H = 630
// Breathing room so the outermost strokes are not flush against the card edge,
// where a platform's rounded corners or drop shadow would clip them.
const INSET = 28

interface CanvasMeta {
  seed_word: string
  slot_count: number
  status: string
  listed: boolean
  slots_filled: number
  width: number | null
  height: number | null
}

async function fetchJson<T>(url: string, key: string): Promise<T> {
  const res = await fetch(url, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`rest ${res.status}`)
  return (await res.json()) as T
}

/** The app icon, as bytes, for every path that is not a drawable canvas. */
async function fallback(origin: string): Promise<Response> {
  const res = await fetch(new URL('/icon-512.png', origin))
  const body = await res.arrayBuffer()
  return new Response(body, {
    headers: {
      'content-type': 'image/png',
      // Short: a canvas that has no image yet is usually one that is about to,
      // and this answer should not outlive that.
      'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
    },
  })
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin
  const id = url.searchParams.get('id') ?? ''

  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!UUID.test(id) || !base || !key) return fallback(origin)

  try {
    const rows = await fetchJson<CanvasMeta[]>(
      `${base}/rest/v1/canvases?id=eq.${id}` +
        `&select=seed_word,slot_count,status,listed,slots_filled,width,height`,
      key,
    )
    const canvas = rows?.[0]

    // An unlisted canvas keeps its page but not a richer preview — the same
    // line api/canvas.ts draws. A canvas with no hands on it is a blank sheet,
    // which is a worse preview than the icon that says what the app is.
    if (!canvas || !canvas.listed || canvas.slots_filled < 1) return fallback(origin)

    const layerRows = await fetchJson<{ slot_index: number; strokes: EncodedLayer }[]>(
      `${base}/rest/v1/layers?canvas_id=eq.${id}` +
        `&select=slot_index,strokes&order=slot_index.asc`,
      key,
    )
    // RLS drops hidden layers before they reach here, exactly as it does for the
    // canvas page; a moderated hand is absent from the preview too.
    const layers: Stroke[][] = layerRows.map((r) => decodeLayer(r.strokes))
    if (layers.every((l) => l.length === 0)) return fallback(origin)

    const w = canvas.width ?? CANVAS_W
    const h = canvas.height ?? CANVAS_H

    const cv = createCanvas(CARD_W, CARD_H)
    const ctx = cv.getContext('2d')

    // Paper first, edge to edge, in device space. The drawing's own ground is
    // this same colour, so there is no seam between the sheet and the mat — one
    // continuous piece of paper with the drawing sitting in the middle of it.
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, CARD_W, CARD_H)

    // Contain the square within the card's height, centred. `drawLayers` works
    // in logical canvas coordinates and sets its own line widths, so the whole
    // mapping from a 2048 sheet to this card is this one transform — the same
    // arrangement `renderLayers` uses in the browser.
    const box = CARD_H - 2 * INSET
    const scale = box / Math.max(w, h)
    const drawW = w * scale
    const drawH = h * scale
    ctx.setTransform(scale, 0, 0, scale, (CARD_W - drawW) / 2, (CARD_H - drawH) / 2)

    // The one cast: napi's context is the same 2D API by structure, and every
    // call drawLayers makes — quadraticCurveTo, multiply, fill('evenodd') — is
    // one Skia implements. Verified against a browser render, not assumed.
    drawLayers(ctx as unknown as CanvasRenderingContext2D, layers)

    const png = cv.toBuffer('image/png')
    const closed = canvas.status === 'closed'
    return new Response(png, {
      headers: {
        'content-type': 'image/png',
        // A closed canvas can never change, so its image is effectively
        // immutable and worth caching for a year. An open one gains hands, so
        // its preview has to be allowed to go stale within the minute.
        'cache-control': closed
          ? 'public, max-age=0, s-maxage=31536000, stale-while-revalidate=86400, immutable'
          : 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
      },
    })
  } catch {
    // A preview is a nicety; a broken image is worse than a plain one.
    return fallback(origin)
  }
}
