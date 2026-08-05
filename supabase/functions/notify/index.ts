/**
 * The sender.
 *
 * Reads whatever the queue owes, encrypts one push per subscription, and
 * records what happened to each. Deliberately dumb: it holds no schema
 * knowledge beyond the two RPCs, does no joins, and decides nothing about who
 * should hear what. All of that is in `0022_notifications.sql`, where it can
 * be reasoned about next to the data.
 *
 * It is a worker rather than a trigger because a trigger that makes an HTTP
 * call puts a push service on the critical path of somebody submitting a
 * drawing, and that is the one operation in this product that must not fail
 * for an unrelated reason.
 *
 * Deploy:
 *   supabase functions deploy notify --no-verify-jwt
 *
 * Secrets it needs, none of which are in this repo:
 *   SUPABASE_URL                  set for you by the platform
 *   SUPABASE_SERVICE_ROLE_KEY     set for you by the platform
 *   VAPID_PUBLIC_KEY              npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT                 mailto: or https:, an address a push
 *                                 service can complain to
 *   NOTIFY_SECRET                 a random string; the caller must send it
 *
 * Schedule it once the secrets exist:
 *   select cron.schedule('longhand-notify', '* * * * *', $$
 *     select net.http_post(
 *       url     := '<project>/functions/v1/notify',
 *       headers := '{"x-notify-secret": "<NOTIFY_SECRET>"}'::jsonb
 *     )$$);
 *
 * Until then nothing sends and nothing breaks: the queue fills, the rows stay
 * pending, and the moment the worker runs everyone gets the one notification
 * that is actually still true. A queue that survives its sender not existing
 * is the whole reason the queue is a table.
 */

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

interface Pending {
  id: string
  kind: 'added' | 'closed'
  canvas: string
  seed: string
  slots: number
  filled: number
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * What a notification says.
 *
 * Quiet, specific, and never a nudge. It names the canvas by its seed word
 * because that is the only name a canvas has, and it says what happened rather
 * than asking for anything. There is no "come back", no count of how long it
 * has been, and no second notification if this one is ignored.
 */
function compose(n: Pending) {
  if (n.kind === 'closed') {
    return {
      title: `“${n.seed}” is finished`,
      body: `${n.slots} hands, including yours. It can never be changed now.`,
    }
  }
  return {
    title: `Another hand on “${n.seed}”`,
    body: `${n.filled} of ${n.slots}. Your layer is still exactly where you left it.`,
  }
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('NOTIFY_SECRET')
  if (!secret || req.headers.get('x-notify-secret') !== secret) {
    // Not 401: an unauthenticated caller should learn nothing about whether
    // this endpoint exists or what it does.
    return new Response('not found', { status: 404 })
  }

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) {
    return Response.json(
      { error: 'VAPID keys are not configured; nothing was sent' },
      { status: 503 },
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const { data, error } = await db.rpc('pending_notifications', { p_limit: 200 })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const pending = (data ?? []) as Pending[]
  let sent = 0
  let failed = 0
  let retired = 0

  for (const n of pending) {
    const { title, body } = compose(n)
    try {
      await webpush.sendNotification(
        { endpoint: n.endpoint, keys: { p256dh: n.p256dh, auth: n.auth } },
        JSON.stringify({ title, body, url: `/c/${n.canvas}`, tag: n.canvas }),
        { TTL: 60 * 60 * 24 * 3 },
      )
      await db.rpc('mark_notification', { p_id: n.id, p_sent: true })
      sent++
    } catch (e) {
      // 404 and 410 mean the browser is gone for good — an uninstalled PWA, a
      // cleared site. That is the ordinary end of a subscription rather than a
      // failure, so the endpoint is retired instead of being retried nightly
      // forever.
      const status = (e as { statusCode?: number }).statusCode
      const gone = status === 404 || status === 410
      await db.rpc('mark_notification', {
        p_id: n.id,
        p_sent: false,
        p_error: `${status ?? 'error'}: ${(e as Error).message}`.slice(0, 300),
        p_endpoint: n.endpoint,
        p_gone: gone,
      })
      if (gone) retired++
      failed++
    }
  }

  return Response.json({ pending: pending.length, sent, failed, retired })
})
