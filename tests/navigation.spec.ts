import { expect, test } from '@playwright/test'

/**
 * Moving between sections without leaving.
 *
 * Every screen used to be a full document load, which is the beat of nothing
 * that made this read as a website. The assertion that matters is not that the
 * right screen appears — that worked before — but that the *same page* is
 * still running when it does.
 *
 * A marker on `window` is the whole test. It cannot survive a document being
 * replaced, so if it is still there afterwards, nothing was replaced.
 */

const phone = { width: 390, height: 844 }
test.use({ viewport: phone })

/** Something a reload would destroy. */
async function markThePage(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    ;(window as unknown as Record<string, unknown>).__sameDocument = true
  })
}

async function stillTheSamePage(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__sameDocument === true,
  )
}

test('the tab bar moves between sections without reloading', async ({ page }) => {
  await page.goto('/gallery')
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
  await markThePage(page)

  await page.getByRole('link', { name: 'World' }).click()
  await expect(page.getByRole('heading', { name: 'The world' })).toBeVisible()
  expect(page).toHaveURL(/\/world$/)
  expect(
    await stillTheSamePage(page),
    'the page was replaced — this is still a full document load',
  ).toBe(true)

  await page.getByRole('link', { name: 'Gallery' }).click()
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
  expect(
    await stillTheSamePage(page),
    'going back to the gallery replaced the page',
  ).toBe(true)
})

test('the splash does not replay on every navigation', async ({ page }) => {
  await page.goto('/gallery')
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
  // It has done its job by now and removes itself.
  await expect(page.locator('#boot')).toHaveCount(0)

  await page.getByRole('link', { name: 'World' }).click()
  await expect(page.getByRole('heading', { name: 'The world' })).toBeVisible()
  expect(
    await page.locator('#boot').count(),
    'the wordmark came back — a section change is showing the launch splash',
  ).toBe(0)
})

test('the back button retraces the sections', async ({ page }) => {
  await page.goto('/gallery')
  await page.getByRole('link', { name: 'World' }).click()
  await expect(page.getByRole('heading', { name: 'The world' })).toBeVisible()
  await markThePage(page)

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'The gallery' })).toBeVisible()
  expect(
    await stillTheSamePage(page),
    'going back reloaded rather than restoring the screen',
  ).toBe(true)
})

test('the current section is marked in the bar', async ({ page }) => {
  await page.goto('/gallery')
  await expect(page.locator('.tab[aria-current="page"]')).toHaveText(/Gallery/)

  await page.getByRole('link', { name: 'World' }).click()
  await expect(page.locator('.tab[aria-current="page"]')).toHaveText(/World/)
})

test('links out of the app are left to the browser', async ({ page }) => {
  await page.goto('/gallery')
  const hijacked = await page.evaluate(() => {
    const a = document.createElement('a')
    a.href = 'https://example.com/somewhere'
    a.textContent = 'out'
    document.body.appendChild(a)
    let defaultPrevented = false
    a.addEventListener('click', (e) => {
      defaultPrevented = e.defaultPrevented
      // Stop the navigation actually happening; we only care who claimed it.
      e.preventDefault()
    })
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    return defaultPrevented
  })
  expect(hijacked, 'the router swallowed a link to another origin').toBe(false)
})
