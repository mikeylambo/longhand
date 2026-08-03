import { expect, test, type APIRequestContext } from '@playwright/test'
import { ledgerEnv, type Ledger } from './support/ledger'

/**
 * The ink budget, asserted against the real endpoint.
 *
 * Every other test in this suite runs through the app. This one deliberately
 * does not: it hand-crafts HTTP the way an attacker or a modified client would,
 * because the thing being tested is precisely what happens when the client
 * cannot be trusted. Going through the UI would only prove the UI behaves.
 *
 * It matters because the ledger is append-only. An oversized layer cannot be
 * undone once written — only hidden — so the budget has to hold at the door.
 *
 * This spec writes rows, so it runs only against the throwaway project named in
 * .env.test.local. tests/support/ledger.ts refuses the live archive outright,
 * and refuses to run at all if no throwaway is configured — a skipped safety
 * test reads as green, which is worse than a red one.
 *
 * Nothing here cleans up after itself. On a throwaway that is the right trade:
 * cleanup would mean either deleting from an append-only table or standing its
 * trigger down, and neither belongs in a routine test run.
 */

let LEDGER: Ledger

test.beforeAll(() => {
  LEDGER = ledgerEnv()
})

const rpc = (api: APIRequestContext, fn: string, body: unknown) =>
  api.post(`${LEDGER.url}/rest/v1/rpc/${fn}`, { headers: LEDGER.headers, data: body })

/** A stroke of a known length, held in very few points. */
function zigzag(colour: string, spanPx: number, legs: number) {
  const p: number[] = []
  for (let i = 0; i <= legs; i++) p.push(i % 2 === 0 ? 20 : 20 + spanPx, 20, 9, i * 16)
  return { c: colour, s: 1, t: 0, i: 1, p }
}

const layer = (strokes: unknown[]) => ({ v: 1, w: 2048, h: 2048, strokes })

test.describe('ink budget', () => {
  test('an over-budget layer is refused, however small the request', async ({ request }) => {
    const stamp = Date.now().toString(36)

    const sigRes = await request.post(`${LEDGER.url}/rest/v1/signatures?select=id`, {
      headers: { ...LEDGER.headers, Prefer: 'return=representation' },
      data: {
        stroke_data: layer([{ c: '#1B1A17', s: 1, t: 0, i: 9, p: [1, 1, 6, 0] }]),
        device_key: `ink-probe-${stamp}`,
      },
    })
    expect(sigRes.ok(), await sigRes.text()).toBeTruthy()
    const signatureId = (await sigRes.json())[0].id as string
    const deviceKey = `ink-probe-${stamp}`

    const claimRes = await rpc(request, 'claim_turn', {
      p_signature: signatureId,
      p_device_key: deviceKey,
    })
    expect(claimRes.ok(), await claimRes.text()).toBeTruthy()
    const claim = await claimRes.json()
    const turnId = claim.turn.id as string
    const canvasId = claim.canvas.id as string
    const budget = claim.canvas.ink_budget as number

    const layersBefore = await request.get(
      `${LEDGER.url}/rest/v1/layers?canvas_id=eq.${canvasId}&select=id`,
      { headers: LEDGER.headers },
    )
    const countBefore = (await layersBefore.json()).length

    // 20 legs of 2000px = 40,000px of travel, four times the budget — in a
    // request of a few hundred bytes. The size caps cannot catch this; only
    // measuring the geometry can.
    const oversized = layer([zigzag('#1B1A17', 2000, 20)])
    expect(JSON.stringify(oversized).length).toBeLessThan(2000)

    const refused = await rpc(request, 'submit_turn', {
      p_turn: turnId,
      p_strokes: oversized,
      // and the client lies about it, to prove p_ink is not what's checked
      p_ink: 12,
      p_device_key: deviceKey,
    })

    expect(refused.ok(), 'an over-budget layer was accepted').toBeFalsy()
    const body = await refused.json()
    expect(body.message).toMatch(/ink/i)
    expect(body.message).toContain(String(budget))
    // the error has to be readable in the failure banner, not a constraint dump
    expect(body.message).not.toMatch(/violates|constraint|SQLSTATE/i)

    const layersAfter = await request.get(
      `${LEDGER.url}/rest/v1/layers?canvas_id=eq.${canvasId}&select=id`,
      { headers: LEDGER.headers },
    )
    expect(
      (await layersAfter.json()).length,
      'a refused layer still reached the ledger',
    ).toBe(countBefore)

    // A layer inside the budget goes through, and the stored figure is the
    // server's measurement rather than the number the client sent.
    const legal = layer([zigzag('#1B1A17', 500, 4)]) // 2000px of travel
    const accepted = await rpc(request, 'submit_turn', {
      p_turn: turnId,
      p_strokes: legal,
      p_ink: 999999,
      p_device_key: deviceKey,
    })
    expect(accepted.ok(), await accepted.text()).toBeTruthy()
    const stored = (await accepted.json()).layer
    expect(stored.ink_used).toBe(2000)
    expect(stored.ink_used).toBeLessThan(budget)
  })

  test('the budget is the canvas\'s own, not a client constant', async ({ request }) => {
    const canvases = await request.get(
      `${LEDGER.url}/rest/v1/canvases?select=ink_budget,width,height&limit=1`,
      { headers: LEDGER.headers },
    )
    expect(canvases.ok()).toBeTruthy()
    const rows = await canvases.json()
    test.skip(rows.length === 0, 'no canvas to inspect')
    // Stored per canvas so a closed canvas stays judged by the rules it was
    // played under, the same reasoning as width and height.
    expect(rows[0].ink_budget).toBeGreaterThan(0)
    expect(rows[0].width).toBeGreaterThan(0)
    expect(rows[0].height).toBeGreaterThan(0)
  })

  test('the colours the client derives are the colours the database stores', async ({
    request,
    page,
  }) => {
    // colour.spec.ts checks the client against a copy of the migration, which
    // can drift from the table itself. This checks it against the table.
    const res = await request.get(
      `${LEDGER.url}/rest/v1/palette_colors?select=hex,base_idx,step&order=base_idx,step`,
      { headers: LEDGER.headers },
    )
    expect(res.ok(), await res.text()).toBeTruthy()
    const rows = (await res.json()) as {
      hex: string
      base_idx: number
      step: number
    }[]
    expect(rows.length, 'palette_colors is empty — migrations not applied?').toBe(80)

    const stored = new Map<number, string[]>()
    for (const r of rows) {
      if (!stored.has(r.base_idx)) stored.set(r.base_idx, [])
      stored.get(r.base_idx)!.push(r.hex.toUpperCase())
    }

    await page.goto('/')
    const derived = await page.evaluate(async () => {
      const { family } = await import('/src/colour.ts')
      const { MASTER_PALETTE } = await import('/src/config.ts')
      return MASTER_PALETTE.map((hex) => family(hex).map((h) => h.toUpperCase()))
    })

    expect(derived.length).toBe(stored.size)
    for (const [baseIdx, fam] of stored) {
      expect(derived[baseIdx], `family ${baseIdx} drifted from the database`).toEqual(fam)
    }
  })
})
