#!/usr/bin/env node
/**
 * Draws the app icons.
 *
 * Rendered rather than hand-drawn so the mark stays in step with the palette
 * and the paper — an icon that drifts from the product it opens is the first
 * thing that makes an installed app feel like a bookmark.
 *
 *   node scripts/make-icons.mjs
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const draw = (size, maskable) => `(() => {
  const S = ${size}, pad = ${maskable ? 0.19 : 0.085};
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const c = cv.getContext('2d');

  // Paper, full bleed — a maskable icon must have no transparent corners.
  c.fillStyle = '#F2EDE3';
  c.fillRect(0, 0, S, S);

  const m = S * pad, w = S - m * 2;
  const P = (x, y) => [m + x * w, m + y * w];
  const curve = (pts, colour, width, cap) => {
    c.strokeStyle = colour; c.lineWidth = width * S; c.lineCap = cap || 'round'; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(...P(pts[0][0], pts[0][1]));
    for (let i = 1; i < pts.length - 1; i++) {
      const a = P(pts[i][0], pts[i][1]), b = P(pts[i+1][0], pts[i+1][1]);
      c.quadraticCurveTo(a[0], a[1], (a[0]+b[0])/2, (a[1]+b[1])/2);
    }
    const last = P(pts[pts.length-1][0], pts[pts.length-1][1]);
    c.lineTo(last[0], last[1]);
    c.stroke();
  };

  // Three hands crossing the same sheet.
  curve([[0.03,0.70],[0.26,0.40],[0.52,0.62],[0.78,0.30],[0.97,0.44]], '#A73A34', 0.062);
  curve([[0.05,0.42],[0.30,0.66],[0.58,0.34],[0.95,0.62]], '#2C7A73', 0.045);
  curve([[0.10,0.88],[0.40,0.80],[0.70,0.90],[0.94,0.82]], '#1B1A17', 0.034);
  return cv.toDataURL('image/png');
})()`

const b = await chromium.launch()
const p = await b.newPage()
await p.setContent('<html><body></body></html>')

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]) {
  const url = await p.evaluate(draw(size, maskable))
  writeFileSync(join(out, name), Buffer.from(url.split(',')[1], 'base64'))
  console.log(`${name}  ${size}x${size}${maskable ? '  (maskable)' : ''}`)
}
await b.close()
