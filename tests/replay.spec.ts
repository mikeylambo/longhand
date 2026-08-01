import { expect, test } from '@playwright/test'

interface Check {
  name: string
  detail: string
  differing: number
  total: number
  pass: boolean
}

/**
 * The ledger stores instructions, not pictures — so the picture exists twice:
 * once under the artist's finger, and again every time it is rebuilt for the
 * gallery, the timelapse or a print. A drift between those two is invisible in
 * one layer and compounds through twelve, and you only find out when a canvas
 * closes and the print is already wrong.
 *
 * Hence: pixel-exact, not "looks the same". The suite compares the renderer
 * against itself rather than against a checked-in golden image, so it is a real
 * assertion on every machine instead of a flake that gets muted.
 */
test('replay is pixel-exact', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (e) => failures.push(String(e)))

  await page.goto('/?selftest=1')
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>).__selftestDone === true,
    null,
    { timeout: 120_000 },
  )

  expect(failures, 'page errors during the run').toEqual([])

  const result = await page.evaluate(
    () =>
      (window as unknown as { __selftest: { ok: boolean; checks: Check[] } })
        .__selftest,
  )

  expect(result.checks.length).toBeGreaterThan(8)
  for (const c of result.checks) {
    expect(
      c.differing,
      `${c.name} — ${c.detail} (${c.differing} of ${c.total} differ)`,
    ).toBe(0)
  }
  expect(result.ok, 'every replay check must pass').toBe(true)
})
