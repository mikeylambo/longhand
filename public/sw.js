/**
 * Offline shell.
 *
 * Deliberately conservative about staleness. Build assets are content-hashed,
 * so they can be cached forever without risk. HTML cannot — serving a stale
 * index.html would pin someone to an old bundle indefinitely — so navigations
 * go to the network first and only fall back to cache when there isn't one.
 *
 * Nothing from the ledger is ever cached. A canvas that looks finished because
 * it was finished yesterday would be a lie, and the archive is the asset.
 */

const CACHE = 'foolscap-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/**
 * Push.
 *
 * Two events are worth waking somebody for and no others: a hand landed on a
 * canvas you are part of, and a canvas you are part of finished. The payload
 * carries its own text because the service worker must not have to fetch
 * anything to render a notification — a push that arrives on a bad connection
 * and then says nothing is worse than no push.
 *
 * `tag` is the canvas id, so a second notification about the same canvas
 * replaces the first rather than stacking. Somebody who has been away for a
 * week should come back to one line about each canvas, not forty.
 */
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    /* a push with no readable body still gets shown, quietly */
  }
  const title = payload.title || 'Longhand'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.tag || 'foolscap',
      renotify: false,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Focus a tab that is already on that canvas rather than opening a
      // second one. Somebody tapping a notification wants the thing, not
      // another copy of the app.
      for (const win of wins) {
        if (win.url.endsWith(url) && 'focus' in win) return win.focus()
      }
      return clients.openWindow(url)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // never the ledger

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
            return res
          }),
      ),
    )
  }
})
