/**
 * Per-canvas share previews.
 *
 * `/c/<id>` is the link people actually send each other, and every one of them
 * previewed identically: the app icon and the word "Foolscap", because the meta
 * tags live in a static index.html that knows nothing about which canvas is
 * being asked for. The whole point of sharing a finished canvas is the canvas.
 *
 * This serves the same document with three tags rewritten. It is not a render
 * of the artwork — that needs a rasteriser and is a separate piece of work —
 * but a title that names the canvas and says whether it is finished is most of
 * the difference between a link worth opening and a link that looks automated.
 *
 * Deliberately not crawler-sniffing. Serving different HTML to a scraper than
 * to a person is cloaking, it breaks the moment a scraper changes its user
 * agent, and it means the thing you tested is not the thing that ships. Every
 * request for /c/<id> comes through here and gets the same document, which
 * costs one indexed lookup on a page that is already going to make several.
 *
 * The body is fetched from the deployment's own static index.html rather than
 * held here as a template, so it cannot drift from what the build produced —
 * a copy of the head in this file would be wrong the first time a script tag
 * changed and nobody would notice until sharing broke.
 */

export const config = { runtime: 'edge' }

// Vercel injects these at runtime. Declared rather than pulled in from
// @types/node, which would bring a whole platform's types into a file that
// uses two globals the edge runtime already provides.
declare const process: { env: Record<string, string | undefined> }

const UUID = /^[0-9a-f-]{36}$/i

/** Anything that could close a tag or open an attribute. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function replaceMeta(html: string, property: string, content: string): string {
  // Matches the tag however the formatter has wrapped it — the attributes in
  // index.html are split across lines, so a single-line pattern would silently
  // match nothing and leave the generic tag in place.
  const re = new RegExp(
    `<meta\\s+property="${property}"[\\s\\S]*?/>|<meta\\s+property="${property}"[^>]*>`,
    'i',
  )
  const tag = `<meta property="${property}" content="${escapeHtml(content)}" />`
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
}

function replaceTitle(html: string, title: string): string {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
}

const HANDS: Record<number, string> = {
  2: 'Two hands',
  4: 'Four hands',
  12: 'Twelve hands',
  24: 'A classroom of twenty-four',
  100: 'A marathon of a hundred',
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.pathname.split('/').pop() ?? ''

  // The shell is served either way. A bad id is the app's 404 to render, not
  // this function's, and a canvas that cannot be read should still open.
  const shell = await fetch(new URL('/index.html', url.origin), {
    headers: { 'x-shell': '1' },
  })
  let html = await shell.text()

  const base = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

  if (UUID.test(id) && base && key) {
    try {
      const res = await fetch(
        `${base}/rest/v1/canvases?id=eq.${id}&select=seed_word,slot_count,slots_filled,status,listed`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } },
      )
      const rows = (await res.json()) as {
        seed_word: string
        slot_count: number
        slots_filled: number
        status: string
        listed: boolean
      }[]
      const c = rows?.[0]

      // An unlisted canvas keeps its URL and its page — that is the whole
      // point of unlisting rather than deleting — but it should not gain a
      // richer preview for being passed around.
      if (c && c.listed) {
        const hands = HANDS[c.slot_count] ?? `${c.slot_count} hands`
        const closed = c.status === 'closed'
        const title = `“${c.seed_word}” — Foolscap`
        const description = closed
          ? `${hands}, finished. It can never be changed now.`
          : `${hands}. ${c.slots_filled} so far, and a place still open.`

        html = replaceTitle(html, title)
        html = replaceMeta(html, 'og:title', title)
        html = replaceMeta(html, 'og:description', description)
        html = replaceMeta(html, 'og:url', `${url.origin}/c/${id}`)
        html = html.replace(
          /<meta\s+name="description"[\s\S]*?\/>/i,
          `<meta name="description" content="${escapeHtml(description)}" />`,
        )
      }
    } catch {
      // A preview is a nicety. The page opening is not.
    }
  }

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Short, because a canvas gains hands and then closes. Long enough that
      // a link doing the rounds does not query the database once per scrape.
      'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
    },
  })
}
