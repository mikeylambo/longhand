import { expect, test } from '@playwright/test'

/**
 * The first visit.
 *
 * Everything here is about a stranger, and a stranger only arrives once. The
 * failure this guards is silent: the welcome screen is behind a localStorage
 * flag, so once it has been seen it is invisible to whoever is developing —
 * you can break it thoroughly and never notice, because your own browser
 * stopped showing it weeks ago.
 *
 * Runs without a database. The clip is a baked fixture and the flag is local,
 * so none of this needs a ledger, which also means it cannot be skipped for
 * want of one.
 */

const phone = { width: 390, height: 844 }

test.use({ viewport: phone })

test.describe('the first visit', () => {
  test('leads with the clip, promises ink, and offers one way in', async ({ page }) => {
    await page.goto('/')

    // The clip is the teaching object and it has to be above the fold, so it
    // comes before the heading in the document rather than after it.
    const reel = page.locator('.reel canvas')
    await expect(reel).toBeVisible()
    const reelBox = await reel.boundingBox()
    const headingBox = await page.locator('h1').boundingBox()
    expect(reelBox!.y).toBeLessThan(headingBox!.y)

    // It has to have painted something. A blank canvas would be the failure
    // that looks exactly like a working one in a screenshot review.
    const drawn = await reel.evaluate((cv: HTMLCanvasElement) => {
      const px = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
      const seen = new Set<string>()
      for (let i = 0; i < px.length; i += 4) {
        seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`)
        if (seen.size > 3) break
      }
      return seen.size
    })
    expect(drawn, 'the clip is one flat colour — nothing was painted').toBeGreaterThan(3)

    // The rule stated before they draw, framed as a promise — and in words a
    // child reads as easily as the person who came here on purpose.
    await expect(page.getByText(/never rub any of it out/i)).toBeVisible()
    await expect(page.getByText(/so does everyone else/i)).toBeVisible()

    // And the timer explained once, as room rather than as a countdown.
    await expect(page.getByText(/time to think, not a race/i)).toBeVisible()

    // One way forward, on screen without scrolling.
    const cta = page.getByRole('button', { name: 'Add yours' })
    await expect(cta).toBeVisible()
    const ctaBox = await cta.boundingBox()
    expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(phone.height)

    // Terms and the safety position are reachable from where they are standing.
    await expect(page.getByRole('link', { name: 'Terms' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Safety' })).toBeVisible()
  })

  test('the signature step says what a signature is for', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add yours' }).click()

    await expect(page.getByRole('heading', { name: 'Your mark' })).toBeVisible()
    // It leads with the doing — draw a squiggle — and only then says what the
    // mark is for, so it reads as an invitation rather than as a form.
    await expect(page.getByText(/draw your mark/i)).toBeVisible()
    await expect(page.getByText(/your mark is your name/i)).toBeVisible()
    await expect(page.getByText(/not asking who you are/i)).toBeVisible()

    // The box says it is for drawing in, for somebody who would not otherwise
    // know a blank rectangle was theirs to touch. Exact, because the paragraph
    // above it also contains the words "you draw here".
    await expect(page.getByText('draw here', { exact: true })).toBeVisible()
  })

  test('is shown once, and never again', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add yours' }).click()
    await expect(page.getByRole('heading', { name: 'Your mark' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Your mark' })).toBeVisible()
    await expect(page.locator('.reel')).toHaveCount(0)
  })

  test('terms and the safety position are real pages, not a promise of one', async ({
    page,
  }) => {
    await page.goto('/terms')
    await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible()
    // The two things that cannot be settled retroactively.
    await expect(page.getByText(/non-exclusive/i).first()).toBeVisible()
    await expect(page.getByText(/each contributor owns their own layer/i)).toBeVisible()

    await page.goto('/safety')
    await expect(page.getByRole('heading', { name: /young people/i })).toBeVisible()
    await expect(page.getByText(/aged 13 and over/i)).toBeVisible()
    // The safeguarding is the absence of the features, so it has to say so.
    await expect(page.getByText(/no chat, no comments/i)).toBeVisible()
  })
})
