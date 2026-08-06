/**
 * Every raster icon, regenerated from the one vector.
 *
 * `brand/foolscap-mark.svg` is the source and the only place the mark is
 * drawn. These outputs are derived, so nothing here should ever be edited by
 * hand — if an icon is wrong, the fix is in the SVG or in this file, and then
 * you run it again:
 *
 *   node scripts/icons.mjs
 *
 * Chromium does the rendering because it is already installed for the tests
 * and it rasterises SVG exactly as the browsers that will show these do. That
 * avoids the classic icon bug where a build-time rasteriser disagrees with the
 * platform about a path and nobody notices until it is on a home screen.
 */

import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CREAM = '#E7E0D2'

/**
 * How much of the square the mark fills.
 *
 * `any` icons follow the supplied masters at 80%. Maskable is a different
 * question and the reason it gets its own asset: the platform may crop to a
 * circle of 80% diameter, so the mark has to fit *inside that circle* rather
 * than inside the square. The mark is 602×769, so its diagonal is 1.27× its
 * height — fitting that in a 0.8 circle allows a height of 0.63, and 0.58
 * leaves room for the shapes' irregular edges.
 */
const FILL = { any: 0.8, maskable: 0.58 }

const TARGETS = [
  { file: 'public/icon-192.png', size: 192, fill: FILL.any },
  { file: 'public/icon-512.png', size: 512, fill: FILL.any },
  { file: 'public/icon-maskable-512.png', size: 512, fill: FILL.maskable },
  // Opaque on purpose: iOS composites a transparent apple-touch-icon onto
  // black, which would put the mark in a dark box on the home screen.
  { file: 'public/apple-touch-icon.png', size: 180, fill: FILL.any },
  { file: 'public/favicon-32.png', size: 32, fill: FILL.any },
  { file: 'public/favicon-16.png', size: 16, fill: FILL.any },
]

const page = (svg, size, fill) => `<!doctype html><html><body style="margin:0">
  <div style="width:${size}px;height:${size}px;background:${CREAM};
              display:flex;align-items:center;justify-content:center;overflow:hidden">
    <div style="height:${Math.round(size * fill)}px;display:flex">${svg}</div>
  </div></body></html>`

const mark = await readFile(resolve(root, 'brand/foolscap-mark.svg'), 'utf8')
// Height drives the fit because the mark is taller than it is wide; width
// follows from the viewBox so the aspect is never touched.
const svg = mark.replace('<svg ', '<svg style="height:100%;width:auto;display:block" ')

const browser = await chromium.launch()
for (const { file, size, fill } of TARGETS) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await p.setContent(page(svg, size, fill))
  const out = resolve(root, file)
  await mkdir(dirname(out), { recursive: true })
  await p.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } })
  await p.close()
  console.log(`${file}  ${size}×${size}  mark at ${Math.round(fill * 100)}%`)
}
await browser.close()

/**
 * The favicon browsers should actually prefer.
 *
 * An SVG favicon scales to whatever the tab is asking for, which matters here
 * because the `f` is negative space: a 16px raster closes its counters, and
 * the vector simply does not have that problem. The PNGs above stay as the
 * fallback for anything that will not take an SVG.
 */
const favicon = mark
  .replace('<svg ', `<svg width="64" height="64" `)
  .replace(
    /(<svg[^>]*>)/,
    `$1<rect x="-40" y="-40" width="700" height="860" fill="${CREAM}"/>`,
  )
  .replace('viewBox="0 0 602 769"', 'viewBox="-40 -40 682 849"')
await writeFile(resolve(root, 'public/favicon.svg'), favicon)
console.log('public/favicon.svg  vector, no counter-closing at any size')
