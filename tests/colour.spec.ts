import { expect, test } from '@playwright/test'

/**
 * The client draws the tint fan-out itself so a long press is instant, but the
 * database is what decides whether a colour may be stored. If the two ever
 * disagree the UI cheerfully offers a colour that gets rejected at submit —
 * after the drawing is finished.
 *
 * So: every family the client derives must be exactly the family sitting in
 * `palette_colors`, byte for byte. These are the stored values, copied out of
 * the migration.
 */
const STORED: Record<string, string[]> = {
  '#1B1A17': ['#0E0D0C', '#141311', '#1B1A17', '#656157', '#A09D93'],
  '#5B5850': ['#2E2C28', '#43413B', '#5B5850', '#8F8B81', '#B8B6B1'],
  '#9C978B': ['#504C44', '#767164', '#9C978B', '#B9B6AE', '#D3D1CD'],
  '#FBF8F1': ['#C39833', '#DFC78D', '#FBF8F1', '#F9F5EC', '#F8F4ED'],
  '#A73A34': ['#551C19', '#7C2A26', '#A73A34', '#C96E69', '#D9A7A5'],
  '#DD6238': ['#792C12', '#B1421C', '#DD6238', '#E19479', '#E8BEAF'],
  '#E5A23C': ['#82540E', '#BE7C18', '#E5A23C', '#E7BD7C', '#EBD4B1'],
  '#B8873C': ['#5E441C', '#89642B', '#B8873C', '#CCAB77', '#DCC9AD'],
  '#7C8A47': ['#3E4623', '#5C6734', '#7C8A47', '#A7B477', '#C6CDAC'],
  '#48764F': ['#233C27', '#35583A', '#48764F', '#77A77E', '#ABC6AF'],
  '#2C7A73': ['#153E3A', '#205B56', '#2C7A73', '#54BAB0', '#98CFCA'],
  '#3B6288': ['#1D3145', '#2B4965', '#3B6288', '#6A91B8', '#A4BACF'],
  '#2B3A72': ['#151C3A', '#1F2B55', '#2B3A72', '#5166B6', '#96A2CD'],
  '#6A4B82': ['#352542', '#4E3761', '#6A4B82', '#987AAE', '#BEAECA'],
  '#A94578': ['#56213C', '#7E3259', '#A94578', '#C47CA1', '#D7B0C4'],
  '#E3A59C': ['#983628', '#CE5D4D', '#E3A59C', '#E9C2BC', '#EFDAD7'],
}

test('the client derives exactly the families the ledger stores', async ({ page }) => {
  await page.goto('/')
  const derived = await page.evaluate(async () => {
    const { family } = await import('/src/colour.ts')
    const { MASTER_PALETTE } = await import('/src/config.ts')
    const out: Record<string, string[]> = {}
    for (const hex of MASTER_PALETTE) out[hex] = family(hex)
    return out
  })

  expect(Object.keys(derived).sort()).toEqual(Object.keys(STORED).sort())
  for (const [base, expected] of Object.entries(STORED)) {
    expect(derived[base], `family of ${base} drifted from the ledger`).toEqual(expected)
  }
})

test('custom hues are held to the palette gamut', async ({ page }) => {
  await page.goto('/')
  const out = await page.evaluate(async () => {
    const { clampToGamut, inGamut, hexToHsl } = await import('/src/colour.ts')
    const sample = [0, 60, 120, 180, 240, 300, 359].map(clampToGamut)
    return {
      sample,
      allInGamut: sample.every(inGamut),
      // hue must survive the clamp — only saturation and lightness are fenced
      hues: sample.map((h) => Math.round(hexToHsl(h).h)),
      // and the things that would wreck a canvas must be refused
      neonGreen: inGamut('#00FF00'),
      neonMagenta: inGamut('#FF00FF'),
      white: inGamut('#FFFFFF'),
      black: inGamut('#000000'),
      mutedGreen: inGamut('#5E8C6A'),
    }
  })

  expect(out.allInGamut, 'clampToGamut produced something out of gamut').toBe(true)
  expect(out.hues).toEqual([0, 60, 120, 180, 240, 300, 359])
  expect(out.neonGreen).toBe(false)
  expect(out.neonMagenta).toBe(false)
  expect(out.white).toBe(false)
  expect(out.black).toBe(false)
  expect(out.mutedGreen).toBe(true)
})
