/**
 * The harbour scene: twelve fixture hands on one sheet.
 *
 * Two things draw from this and they must not drift, because one of them is
 * the first thing a stranger ever sees. `seed-canvas.mjs` pushes it through
 * the real endpoints to fill a canvas in the ledger; `make-welcome.mjs` bakes
 * it into the clip on the welcome screen. When the scene changes, both change.
 *
 * Nothing here touches the network, so it can be rendered anywhere.
 */

export const W = 2048
export const H = 2048
export const HORIZON = 1180
export const INK_BUDGET = 10000
export const SEED_WORD = 'harbour'

// ------------------------------------------------------------------ drawing

export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Summed sines: a cheap smooth wobble, so nothing reads as machine-straight. */
export function wobbler(rand, amp) {
  const p = [rand() * 7, rand() * 7, rand() * 7]
  return (t) =>
    amp * (Math.sin(t * 2.1 + p[0]) * 0.6 + Math.sin(t * 5.3 + p[1]) * 0.3 + Math.sin(t * 11.7 + p[2]) * 0.1)
}

export function line(x1, y1, x2, y2, n, rand, amp = 4) {
  const w = wobbler(rand, amp)
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const o = w(t * 6) * Math.sin(Math.PI * t)
    return [x1 + dx * t + nx * o, y1 + dy * t + ny * o]
  })
}

export function arc(cx, cy, rx, ry, a0, a1, n, rand, amp = 5) {
  const w = wobbler(rand, amp)
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    const a = a0 + (a1 - a0) * t
    const o = w(t * 6)
    return [cx + Math.cos(a) * (rx + o), cy + Math.sin(a) * (ry + o)]
  })
}

/** Catmull-Rom through control points — organic shapes without bezier maths. */
export function through(cps, per, rand, amp = 4) {
  const w = wobbler(rand, amp)
  const pts = []
  const p = [cps[0], ...cps, cps[cps.length - 1]]
  for (let i = 1; i < p.length - 2; i++) {
    for (let j = 0; j < per; j++) {
      const t = j / per
      const t2 = t * t
      const t3 = t2 * t
      const x =
        0.5 * (2 * p[i][0] + (-p[i - 1][0] + p[i + 1][0]) * t +
          (2 * p[i - 1][0] - 5 * p[i][0] + 4 * p[i + 1][0] - p[i + 2][0]) * t2 +
          (-p[i - 1][0] + 3 * p[i][0] - 3 * p[i + 1][0] + p[i + 2][0]) * t3)
      const y =
        0.5 * (2 * p[i][1] + (-p[i - 1][1] + p[i + 1][1]) * t +
          (2 * p[i - 1][1] - 5 * p[i][1] + 4 * p[i + 1][1] - p[i + 2][1]) * t2 +
          (-p[i - 1][1] + 3 * p[i][1] - 3 * p[i + 1][1] + p[i + 2][1]) * t3)
      const o = w((i + t) * 1.3)
      pts.push([x + o * 0.5, y + o])
    }
  }
  pts.push(cps[cps.length - 1])
  return pts
}

export const PEN = [3.5, 9, 20]

/**
 * Converts a path to a stroke with the same width profile the live surface
 * produces: tapered at both ends, drifting slightly along the middle.
 */
export function stroke(path, color, size, rand, t0) {
  const base = PEN[size]
  const taperLen = base * 1.2
  let total = 0
  const cum = [0]
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    cum.push(total)
  }
  const drift = wobbler(rand, 0.16)
  const pts = path.map(([x, y], i) => {
    const fromStart = cum[i]
    const fromEnd = total - cum[i]
    const ramp = Math.min(1, Math.min(fromStart, fromEnd) / Math.max(1, taperLen))
    const f = (0.55 + 0.45 * ramp) * (1 + drift(i * 0.08))
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      w: Math.round(Math.max(0.4, base * f) * 100) / 100,
      t: i * 16,
    }
  })
  return { color, size, t0, ink: Math.round(total), pts }
}

// ------------------------------------------------------------------- scene

// The sixteen families, the tints and shades behind them, and two colours
// mixed on the hue wheel — so a finished canvas shows what the expanded system
// actually looks like rather than only the swatch row.
const INK = '#1B1A17', INK_D = '#0E0D0C', INK_L = '#656157', INK_LL = '#A09D93'
const GRAPHITE = '#5B5850', GRAPHITE_L = '#8F8B81'
const ASH = '#9C978B', ASH_L = '#B9B6AE', ASH_LL = '#D3D1CD'
const CHALK = '#FBF8F1'
const RED = '#A73A34', RED_D = '#7C2A26', RED_DD = '#551C19', RED_L = '#C96E69'
const AMBER = '#E5A23C', AMBER_D = '#BE7C18', AMBER_L = '#E7BD7C', AMBER_LL = '#EBD4B1'
const OCHRE = '#B8873C', OCHRE_L = '#CCAB77'
const FERN = '#48764F', FERN_D = '#233C27', FERN_L = '#77A77E', FERN_LL = '#ABC6AF'
const TEAL = '#2C7A73', TEAL_D = '#205B56', TEAL_L = '#54BAB0', TEAL_LL = '#98CFCA'
const SLATE = '#3B6288', SLATE_D = '#2B4965', SLATE_L = '#6A91B8', SLATE_LL = '#A4BACF'
const VIOLET = '#6A4B82', VIOLET_L = '#987AAE'
// Mixed: any hue, held to the palette's light (h, 52%, 46%).
const MIXED_SEA = '#388EB2'   // hue 198
const MIXED_ROSE = '#B2385D'  // hue 342

/** Twelve hands on one harbour, each adding what the last one left room for. */
export const LAYERS = [
  // 1 — the horizon. Someone has to decide where the world ends.
  (r) => [
    stroke(line(70, HORIZON, 1980, HORIZON - 8, 120, r, 7), INK, 0, r, 0),
    stroke(line(330, HORIZON + 26, 1520, HORIZON + 20, 80, r, 5), ASH_L, 0, r, 1400),
  ],
  // 2 — hills behind it
  (r) => [
    stroke(through([[70, HORIZON], [250, 1078], [450, 1132], [640, HORIZON]], 26, r, 5), FERN_D, 1, r, 0),
    stroke(through([[1330, HORIZON], [1520, 1090], [1740, 1140], [1980, HORIZON - 6]], 26, r, 5), FERN, 1, r, 1600),
    stroke(through([[600, HORIZON], [770, 1124], [930, HORIZON]], 22, r, 4), FERN_L, 0, r, 3100),
    stroke(through([[900, HORIZON - 4], [1120, 1140], [1340, HORIZON - 2]], 20, r, 4), FERN_LL, 0, r, 4400),
  ],
  // 3 — a low sun and some weather
  (r) => [
    stroke(arc(1566, 742, 134, 134, 0, Math.PI * 2, 90, r, 6), AMBER, 1, r, 0),
    stroke(arc(1566, 742, 96, 96, 0, Math.PI * 2, 70, r, 5), AMBER_L, 0, r, 1500),
    stroke(line(300, 700, 720, 686, 40, r, 9), AMBER_LL, 0, r, 2600),
    stroke(line(360, 742, 640, 736, 30, r, 7), AMBER_L, 0, r, 3400),
    stroke(line(1140, 546, 1560, 536, 40, r, 9), AMBER_D, 0, r, 4200),
  ],
  // 4 — the boat everything else will hang off
  (r) => [
    stroke(through([[600, 1226], [688, 1336], [980, 1382], [1230, 1332], [1306, 1224]], 30, r, 4), RED, 2, r, 0),
    stroke(through([[660, 1276], [760, 1352], [990, 1392], [1200, 1348]], 26, r, 4), RED_DD, 1, r, 2200),
    stroke(line(600, 1226, 1306, 1224, 60, r, 4), RED_D, 1, r, 4000),
    stroke(line(700, 1256, 1210, 1254, 40, r, 3), RED_L, 0, r, 5400),
  ],
  // 5 — mast and sail
  (r) => [
    stroke(line(948, 1222, 958, 620, 60, r, 4), INK, 1, r, 0),
    stroke(through([[958, 646], [1120, 900], [1218, 1186]], 30, r, 4), INK, 1, r, 1400),
    stroke(line(1218, 1190, 968, 1200, 34, r, 4), INK, 1, r, 3000),
    stroke(through([[986, 760], [1090, 950], [1150, 1160]], 26, r, 4), CHALK, 2, r, 4200),
    stroke(through([[1010, 900], [1096, 1040], [1132, 1150]], 20, r, 3), ASH_LL, 1, r, 5000),
    stroke(line(958, 660, 972, 1198, 44, r, 3), INK, 0, r, 5400),
  ],
  // 6 — a second, smaller boat further out
  (r) => [
    stroke(through([[1466, 1206], [1522, 1268], [1676, 1286], [1790, 1258], [1824, 1200]], 24, r, 4), OCHRE, 1, r, 0),
    stroke(line(1620, 1206, 1628, 980, 26, r, 3), INK_L, 0, r, 1600),
    stroke(through([[1628, 998], [1712, 1120], [1748, 1198]], 20, r, 3), OCHRE_L, 1, r, 2400),
  ],
  // 7 — water
  (r) => {
    const out = []
    for (let i = 0; i < 26; i++) {
      const y = 1246 + i * 28 + r() * 12
      const len = 90 + r() * 230
      const x = 90 + r() * (W - 200 - len)
      const tone = [TEAL_D, TEAL, TEAL_L, TEAL_LL, MIXED_SEA][i % 5]
      out.push(stroke(line(x, y, x + len, y + (r() - 0.5) * 8, 14, r, 3), tone, 0, r, i * 320))
    }
    return out
  },
  // 8 — what the boats leave on the water
  (r) => {
    const out = []
    const anchors = [[960, 1396], [1010, 1396], [900, 1400], [1660, 1300], [1710, 1300]]
    anchors.forEach(([x, y], i) => {
      for (let k = 0; k < 4; k++) {
        const yy = y + k * 62 + r() * 16
        const tone = [SLATE_D, SLATE, SLATE_L, SLATE_LL][k % 4]
        out.push(stroke(line(x - 46 - r() * 30, yy, x + 46 + r() * 30, yy + 5, 12, r, 6), tone, 0, r, (i * 4 + k) * 260))
      }
    })
    return out
  },
  // 9 — the jetty you are standing on
  (r) => [
    stroke(line(60, 1566, 706, 1502, 50, r, 4), GRAPHITE, 1, r, 0),
    stroke(line(60, 1612, 706, 1548, 50, r, 4), GRAPHITE_L, 0, r, 1500),
    ...[[140, 1600], [320, 1584], [500, 1566], [672, 1548]].map(([x, y], i) =>
      stroke(line(x, y, x + 8, y + 250, 22, r, 4), GRAPHITE, 1, r, 2600 + i * 700),
    ),
  ],
  // 10 — birds
  (r) => {
    const out = []
    const at = [[420, 520], [520, 470], [640, 540], [1740, 470], [1840, 520]]
    at.forEach(([x, y], i) => {
      const s = 26 + r() * 16
      const tone = i % 3 === 2 ? INK_LL : i % 3 === 1 ? INK_L : INK_D
      out.push(stroke(arc(x - s, y, s, s * 0.62, Math.PI * 0.15, Math.PI * 0.85, 14, r, 2), tone, 0, r, i * 500))
      out.push(stroke(arc(x + s, y, s, s * 0.62, Math.PI * 0.15, Math.PI * 0.85, 14, r, 2), tone, 0, r, i * 500 + 250))
    })
    return out
  },
  // 11 — the shore in front
  (r) => [
    stroke(through([[0, 1904], [230, 1856], [470, 1902], [700, 1868], [900, 1918]], 26, r, 7), ASH, 2, r, 0),
    stroke(through([[0, 1976], [300, 1942], [620, 1986], [900, 1958]], 24, r, 6), ASH_L, 1, r, 2400),
    stroke(through([[120, 1930], [420, 1900], [760, 1944]], 20, r, 5), ASH_LL, 0, r, 4200),
  ],
  // 12 — someone on the jetty, and a rope to the boat
  (r) => [
    stroke(arc(300, 1452, 30, 32, 0, Math.PI * 2, 40, r, 3), MIXED_ROSE, 1, r, 0),
    stroke(line(300, 1484, 302, 1560, 18, r, 3), VIOLET, 1, r, 900),
    stroke(line(258, 1512, 344, 1508, 16, r, 3), VIOLET_L, 0, r, 1500),
    stroke(line(302, 1560, 274, 1594, 12, r, 3), VIOLET, 1, r, 2000),
    stroke(line(302, 1560, 330, 1594, 12, r, 3), VIOLET, 1, r, 2400),
    stroke(through([[344, 1508], [520, 1560], [700, 1400], [612, 1244]], 30, r, 5), VIOLET_L, 0, r, 2900),
  ],
]

/** A drawn mark. Cursive-ish, never the same twice. */
export function signatureStrokes(seed) {
  const r = mulberry32(seed)
  const path = []
  const loops = 2 + Math.floor(r() * 3)
  const n = 130
  for (let i = 0; i <= n; i++) {
    const t = i / n
    path.push([
      120 + t * 620,
      190 - Math.sin(t * Math.PI * loops) * (48 + r() * 8) - t * 34 + Math.sin(t * 31) * 4,
    ])
  }
  const out = [stroke(path, INK, 1, r, 0)]
  if (r() > 0.45) out.push(stroke(line(140, 268, 620 + r() * 120, 262, 24, r, 5), INK, 0, r, 2400))
  return out
}

// ---------------------------------------------------------- colour check

export const GAMUT = { minS: 18, maxS: 72, minL: 28, maxL: 72 }

export function hexToSl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  const sat = d === 0 ? 0 : l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  return { s: sat * 100, l: l * 100 }
}

export const inGamut = (hex) => {
  const { s, l } = hexToSl(hex)
  return s >= GAMUT.minS && s <= GAMUT.maxS && l >= GAMUT.minL && l <= GAMUT.maxL
}

// -------------------------------------------------------------------- wire

/** The `layers.strokes` wire format, identical to src/engine/codec.ts. */
export const encode = (strokes, w, h) => ({
  v: 1,
  w,
  h,
  strokes: strokes.map((s) => {
    const p = []
    for (const pt of s.pts) p.push(pt.x, pt.y, pt.w, pt.t)
    return { c: s.color, s: s.size, t: s.t0, i: Math.round(s.ink), p }
  }),
})

/** Every layer of the scene, drawn from its fixed seed. Deterministic: the
 *  same twelve hands every time, so the clip and the seeded canvas match. */
export function scene() {
  return LAYERS.map((make, i) => make(mulberry32(0xc0ffee + (i + 1) * 7919)))
}
