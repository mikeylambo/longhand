import { expect, test, type APIRequestContext } from '@playwright/test'
import { ledgerEnv, type Ledger } from './support/ledger'

/**
 * Formats and the moderation floor, against the real endpoints.
 *
 * Like ledger.spec.ts this hand-crafts HTTP rather than going through the app,
 * because what is being tested is what happens when the client is not the one
 * we wrote. Two classes of claim live here:
 *
 *   - a duo behaves like a canvas and closes with two hands
 *   - the moderation levers are not reachable with the key that ships in the
 *     bundle
 *
 * The second is the one worth the file. `hide_layer` and `set_canvas_listed`
 * are the only two functions in this schema that change what the world sees,
 * and both are one missing GRANT away from being a stranger's toy.
 *
 * Writes rows, so it runs only against the throwaway project named in
 * .env.test.local. tests/support/ledger.ts refuses a live archive outright.
 */

let LEDGER: Ledger

test.beforeAll(() => {
  LEDGER = ledgerEnv()
})

const rpc = (api: APIRequestContext, fn: string, body: unknown) =>
  api.post(`${LEDGER.url}/rest/v1/rpc/${fn}`, { headers: LEDGER.headers, data: body })

const layer = (strokes: unknown[]) => ({ v: 1, w: 2048, h: 2048, strokes })
const oneStroke = () =>
  layer([{ c: '#1B1A17', s: 1, t: 0, i: 1, p: [20, 20, 9, 0, 120, 20, 9, 16] }])

/** A fresh hand every time: one hand per canvas is enforced, so a reused
 *  signature would collide with whatever the last run left behind. */
async function hand(api: APIRequestContext, what: string) {
  const deviceKey = `${what}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const res = await api.post(`${LEDGER.url}/rest/v1/signatures?select=id`, {
    headers: { ...LEDGER.headers, Prefer: 'return=representation' },
    data: { stroke_data: oneStroke(), device_key: deviceKey },
  })
  expect(res.ok(), await res.text()).toBeTruthy()
  return { id: (await res.json())[0].id as string, deviceKey }
}

test.describe('formats', () => {
  test('a duo can be asked for, and two hands close it', async ({ request }) => {
    const a = await hand(request, 'duo-a')
    const claimA = await rpc(request, 'claim_turn', {
      p_signature: a.id,
      p_device_key: a.deviceKey,
      p_slots: 2,
    })
    expect(claimA.ok(), await claimA.text()).toBeTruthy()
    const first = await claimA.json()
    expect(first.canvas.slot_count).toBe(2)

    const submitA = await rpc(request, 'submit_turn', {
      p_turn: first.turn.id,
      p_strokes: oneStroke(),
      p_ink: 100,
      p_device_key: a.deviceKey,
    })
    expect(submitA.ok(), await submitA.text()).toBeTruthy()
    expect((await submitA.json()).canvas.status).not.toBe('closed')

    // The second hand is sent to the duo closest to closing, which is now one
    // that already has a hand on it. If this lands on a fresh duo instead, the
    // bias is broken and the cold-start fix does nothing.
    const b = await hand(request, 'duo-b')
    const claimB = await rpc(request, 'claim_turn', {
      p_signature: b.id,
      p_device_key: b.deviceKey,
      p_slots: 2,
    })
    expect(claimB.ok(), await claimB.text()).toBeTruthy()
    const second = await claimB.json()
    expect(second.canvas.slot_count).toBe(2)
    expect(second.canvas.slots_filled, 'sent to an empty duo, not one waiting on a hand').toBe(1)
    expect(second.turn.slot_index).toBe(2)

    const submitB = await rpc(request, 'submit_turn', {
      p_turn: second.turn.id,
      p_strokes: oneStroke(),
      p_ink: 100,
      p_device_key: b.deviceKey,
    })
    expect(submitB.ok(), await submitB.text()).toBeTruthy()
    const closed = (await submitB.json()).canvas
    expect(closed.status).toBe('closed')
    expect(closed.closed_at).not.toBeNull()
    expect(closed.slots_filled).toBe(2)
  })

  test('a format nobody offers is refused', async ({ request }) => {
    const h = await hand(request, 'bad-format')
    const res = await rpc(request, 'claim_turn', {
      p_signature: h.id,
      p_device_key: h.deviceKey,
      p_slots: 7,
    })
    expect(res.ok(), 'a canvas was opened at a size with no format').toBeFalsy()
    expect((await res.json()).message).toMatch(/no 7 hand format/i)
  })

  test('every format the ledger offers has a name in the client', async ({
    request,
    page,
  }) => {
    // The table is the authority on which sizes exist; these names are only
    // how they are spoken. A format added to the table without a name here
    // would reach a player as a bare number, which is the drift this catches.
    const res = await request.get(
      `${LEDGER.url}/rest/v1/canvas_formats?select=slot_count,label,weight&order=slot_count`,
      { headers: LEDGER.headers },
    )
    expect(res.ok(), await res.text()).toBeTruthy()
    const rows = (await res.json()) as { slot_count: number; label: string }[]
    expect(rows.length, 'canvas_formats is empty — migrations not applied?').toBeGreaterThan(0)

    await page.goto('/')
    const named = await page.evaluate(async () => {
      const { FORMATS } = await import('/src/config.ts')
      return FORMATS.map((f: { slots: number }) => f.slots)
    })
    for (const row of rows) {
      expect(named, `slot_count ${row.slot_count} (${row.label}) has no name`).toContain(
        row.slot_count,
      )
    }
  })
})

test.describe('the moderation floor', () => {
  test('anyone can report, and a second tap is not a second vote', async ({ request }) => {
    const h = await hand(request, 'reporter')
    const claim = await rpc(request, 'claim_turn', {
      p_signature: h.id,
      p_device_key: h.deviceKey,
      p_slots: 2,
    })
    expect(claim.ok(), await claim.text()).toBeTruthy()
    const { turn, canvas } = await claim.json()
    const submitted = await rpc(request, 'submit_turn', {
      p_turn: turn.id,
      p_strokes: oneStroke(),
      p_ink: 100,
      p_device_key: h.deviceKey,
    })
    expect(submitted.ok(), await submitted.text()).toBeTruthy()
    const layerId = (await submitted.json()).layer.id as string

    const onlooker = `onlooker-${Date.now().toString(36)}`
    for (const body of [
      { p_canvas: canvas.id, p_layer: null, p_device_key: onlooker },
      { p_canvas: canvas.id, p_layer: null, p_device_key: onlooker },
      { p_canvas: canvas.id, p_layer: layerId, p_device_key: onlooker },
    ]) {
      const res = await rpc(request, 'report_content', body)
      expect(res.ok(), await res.text()).toBeTruthy()
    }

    // A layer that is not on that canvas is a bug in the client, not abuse, so
    // it is the one thing reporting refuses out loud.
    const wrong = await rpc(request, 'report_content', {
      p_canvas: canvas.id,
      p_layer: h.id, // a signature id — real uuid, wrong table
      p_device_key: onlooker,
    })
    expect(wrong.ok()).toBeFalsy()
    expect((await wrong.json()).message).toMatch(/not on that canvas/i)
  })

  test('nobody with the publishable key can read reports or the queue', async ({
    request,
  }) => {
    for (const path of [
      'reports?select=id',
      'reports?select=device_key',
      'moderation_queue?select=canvas_id',
      'moderation_actions?select=id',
    ]) {
      const res = await request.get(`${LEDGER.url}/rest/v1/${path}`, {
        headers: LEDGER.headers,
      })
      expect(res.ok(), `${path} was readable with the publishable key`).toBeFalsy()
    }
  })

  test('nobody with the publishable key can hide, unlist or dismiss', async ({
    request,
  }) => {
    const h = await hand(request, 'attacker')
    const claim = await rpc(request, 'claim_turn', {
      p_signature: h.id,
      p_device_key: h.deviceKey,
      p_slots: 2,
    })
    const { turn, canvas } = await claim.json()
    const submitted = await rpc(request, 'submit_turn', {
      p_turn: turn.id,
      p_strokes: oneStroke(),
      p_ink: 100,
      p_device_key: h.deviceKey,
    })
    const layerId = (await submitted.json()).layer.id as string

    const attempts: [string, unknown][] = [
      ['hide_layer', { p_layer: layerId }],
      ['unhide_layer', { p_layer: layerId }],
      ['set_canvas_listed', { p_canvas: canvas.id, p_listed: false }],
      ['dismiss_reports', { p_canvas: canvas.id }],
      // Superseded by claim_turn and closed to clients in 0018. Left reachable
      // it would let anyone open empty canvases in a loop.
      ['open_or_join_canvas', {}],
      ['pick_format', {}],
    ]
    for (const [fn, body] of attempts) {
      const res = await rpc(request, fn, body)
      expect(res.ok(), `${fn} was callable with the publishable key`).toBeFalsy()
    }

    // And the layer is still served, which is the thing those calls would have
    // changed.
    const still = await request.get(
      `${LEDGER.url}/rest/v1/layers?id=eq.${layerId}&select=id,hidden`,
      { headers: LEDGER.headers },
    )
    expect((await still.json()).length).toBe(1)
  })

  test('direct writes to reports are refused', async ({ request }) => {
    const res = await request.post(`${LEDGER.url}/rest/v1/reports`, {
      headers: LEDGER.headers,
      data: {
        canvas_id: '00000000-0000-0000-0000-000000000000',
        device_key: 'forged-device-key',
      },
    })
    expect(res.ok(), 'a report was written directly, bypassing the cap').toBeFalsy()
  })
})
