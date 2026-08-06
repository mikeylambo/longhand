# Getting Phase A, B and C onto production

**The schema is deployed.** Production (`uxlhgbvhmukfrhtzzifu`) is at migration
**0029** as of 2026-08-06. The archive came through it untouched: 1 canvas, 12
layers, 12 signatures, exactly as they were before.

Two of the three deploy steps below are done. The one that is not is
notifications, and it is waiting on a person rather than on code — see
[What is still outstanding](#what-is-still-outstanding).

The rest of this file is both the record of that deploy and the procedure for
doing it again on an empty project.

## The order, and why it is that order

**Migrations first, client second.** The client that is live today calls
`claim_turn` with two named arguments, and the four-argument version that 0017
installs still accepts exactly those two. `submit_turn`'s signature never
changes. So the running app keeps working for the whole gap between the two
deploys, and there is no window where the site is broken.

Doing it the other way round breaks the site for as long as the gap lasts: the
new client calls `report_content`, `mint_recovery_key` and `fetch_gallery`,
none of which exist yet on production.

## 1. The schema — done

```bash
supabase link --project-ref uxlhgbvhmukfrhtzzifu
supabase db push
```

`db push` applies everything the remote is missing, in filename order.

On the day, the migrations went up one at a time through Supabase's management
API instead — same SQL, same order, recorded in the same `supabase_migrations`
table, and `supabase migration list` agrees with it afterwards. Either route
works and neither needs Docker: `db push` talks to the remote database, and the
local stack it would need Docker for is not involved in a deploy at all. The
API route was taken because it needs nothing installed, which also makes it the
one to reach for from a machine that is not set up for this project.

Before you run either, write down what the archive holds, so that afterwards
you can say it is untouched rather than assume it:

```sql
select
  (select count(*) from public.canvases)  as canvases,
  (select count(*) from public.layers)    as layers,
  (select count(*) from public.signatures) as signatures,
  (select coalesce(sum(jsonb_array_length(strokes -> 'strokes')), 0)
     from public.layers)                  as strokes;
```

Every migration is `create ... if not exists`, `create or replace`, or an
`alter table ... add column if not exists`, so a re-run is safe and a partial
apply can be finished by running it again. Nothing drops a table, nothing
deletes a row, and the append-only trigger is never stood down.

Three of them do more than add:

| | what to look at afterwards |
|---|---|
| 0017 | drops the three-argument `claim_turn`. Two-argument calls still resolve to the new one — that is what keeps the live client working. |
| 0021 | backfills `signature_devices` from `signatures.device_key`. Expect one row per existing signature. |
| 0027 | replaces `layer_ink` with a version that floors each stroke at 18. Existing rows are not re-measured; only new submissions are affected. |

Then check the archive is exactly as you left it:

```sql
select public.notify_health();   -- should be all zeros, scheduled false
select count(*) from public.canvas_formats;         -- 5
select count(*) from public.places;                 -- 41
select count(*) from public.signature_devices;      -- one per signature
```

All four were as expected on the day, and the three archive counts were
unchanged either side of the push.

### What the deploy turned up

Two things went wrong against real Supabase that had not gone wrong against a
real PostgreSQL, and both are now fixed in the migrations rather than in a
runbook step somebody has to remember.

**pgcrypto is not in `public`.** 0001 asks for pgcrypto without naming a
schema. On a bare PostgreSQL it lands in `public`, so `digest` and
`gen_random_bytes` resolve from a function pinned to `set search_path =
public`. Supabase installs it into `extensions` before the first migration
runs, which makes 0001's `if not exists` a no-op and leaves those two names
unreachable. Nothing fails at apply time, because plpgsql does not resolve a
function name in a body until it runs it — the first sign would have been
somebody tapping "get a recovery key" and getting `function digest(unknown,
unknown) does not exist`. The three functions that need pgcrypto now name both
schemas, and 0021 opens with a check that fails the migration on the spot if
either name is unreachable.

**pg_net's bookkeeping.** 0028's comment claimed pg_net "refuses to be put
anywhere else" and so left `with schema` off. Half right: the objects do refuse
— they are always in `net` — but the catalogue entry does not, and unnamed it
records against `public`, which is a standing security-lint finding for an
extension with nothing in `public` at all. 0028 now names `extensions`. The
live project was corrected in place, because pg_net is not relocatable and a
migration that dropped and recreated an extension on every re-run would be far
worse than the finding.

A third, smaller one: 0027's `mark_floor()` was the only function in the schema
without a pinned `search_path`. Unreachable by any client role and called only
from an already-pinned body, so it was tidiness rather than a hole — but a
standing lint is a thing every future review has to re-investigate before
concluding it is fine, and that cost is paid over and over while the fix is
paid once. 0029 pins it.

The security advisor is now clean of both `function_search_path_mutable` and
`extension_in_public`. What it still reports is 51 findings that are all
intended: 40 are "SECURITY DEFINER, executable by `anon`", which is one finding
wearing forty hats — v1 has no accounts, so `anon` is every player and every
one of those functions checks `owns_signature` before it does anything — and 11
are RLS enabled with no policy, which is deny-all on tables only reachable
through those definer functions. That is the design. The alternative is
accounts, which is a different product.

## 2. Notifications

The sender is **deployed** — `notify`, version 1, `verify_jwt` off — and has
been proved to refuse an unauthenticated caller: called from the database with
no `x-notify-secret` it answers `404 not found`, which is what it should tell
anyone who does not have the secret. It is not scheduled and it has no secrets
yet, so it sends nothing. That is a safe state, not a broken one: without the
VAPID keys it returns 503 and the queue keeps its rows.

`verify_jwt` is off because pg_cron calls it with no user session. The header
is what actually guards it.

What is left needs the CLI or the dashboard, because storing function secrets
is the one step that cannot go through the route §1 used:

```bash
export SUPABASE_DB_URL='postgresql://…'   # Settings → Database → URI
scripts/setup-notify.sh
```

Generates the VAPID keypair and the shared secret, stores them, redeploys the
sender, proves the endpoint answers with the secret and 404s without it, and
only then schedules the minute-by-minute poke. It prints the public key.

`SUPABASE_DB_URL` is optional. Without it the script prints its two SQL
statements for the dashboard's SQL editor instead of running them — which is
worth knowing about, because the scheduling statement carries the shared
secret, and over psql that value never leaves the process.

> The Supabase CLI has no command that runs SQL. `db push` applies migrations,
> `db dump` reads, and `diff`/`lint`/`pull`/`reset` are the rest. This script
> used to call `supabase db execute`, which has never existed — it would have
> failed at the last step, after the secrets were stored and the sender
> deployed, and blamed the project link for it.

### Without installing anything

The CLI is not required. A VAPID keypair is a P-256 keypair and a browser can
make one — open the console on the deployed site, which is HTTPS and therefore
a secure context, and paste:

```js
const kp = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, true, ['sign','verify'])
const raw = await crypto.subtle.exportKey('raw', kp.publicKey)
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
console.log('VAPID_PUBLIC_KEY ', b64(raw))
console.log('VAPID_PRIVATE_KEY', jwk.d)
console.log('NOTIFY_SECRET    ', b64(crypto.getRandomValues(new Uint8Array(24))))
```

The same pair `web-push` would emit: the uncompressed public point and its
scalar, both base64url. Generated locally, nothing transmitted, nothing
installed.

Then Dashboard → Edge Functions → Secrets, four values — `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NOTIFY_SECRET` — and one line in the SQL
editor:

```sql
select public.schedule_notify(
  'https://<ref>.supabase.co/functions/v1/notify', '<NOTIFY_SECRET>');
```

`VAPID_SUBJECT` is `mailto:` or `https://`, and it is a decision rather than a
value: it goes to Apple and Google in every push, so it wants to be an address
meant to leave the building. An alias on the project's own domain is the tidy
answer, which is one reason the domain is worth settling first.

## 3. The client

Vercel → Project → Settings → Environment Variables, for Production and
Preview:

```
VITE_VAPID_PUBLIC_KEY=<what setup-notify.sh printed>
```

Then merge the branch and let Vercel build. Until that variable exists,
`/mark` says the build has no push behind it, which is true.

## 4. Check it came up

- `/` — the welcome clip plays, "Add yours" is on screen without scrolling.
- `/gallery` — the seeded canvas is there, captioned **Twelve hands**.
- `/world` — empty, and says so. Nothing has a place yet.
- `/mark` — offers a recovery key, and a push toggle if the VAPID key landed.
- Take a turn. The tool tray opens. The ink meter moves on a stipple.
- `scripts/moderate.sh queue` — empty, and returns rather than erroring.

## If a migration fails halfway

Stop. Do not run the next one. `supabase db push` reports which file failed and
the error; every file is transactional, so the failed one applied nothing and
the ones before it are complete and safe. Fix the file, push again.

The archive is backed up nightly to GitHub artifacts and to the off-site
bucket, and `scripts/verify-artifact.sh --restore` is the drill for putting it
back. It has been run end to end. That is the floor under all of this.

## What has and has not been tested

All 29 migrations build from nothing against a real PostgreSQL, and 193
behavioural checks pass against that schema — the relay, the formats, the
moderation levers, identity, the notification queue, gifts, places,
classrooms, ink sets, prints and the tools.

Two things that schema was **not** tested against, because both are Supabase
extensions that cannot be installed locally:

- **pg_cron** — the expiry sweep (live since 0005, so this one is proven in
  production already) and the notification poke.
- **pg_net** — the HTTP call the poke makes. Stubbed locally, and the stub
  originally agreed with a mistake in the migration rather than catching it.
  `schedule_notify` now refuses to schedule at all if `net.http_post` does not
  resolve, which turns that class of error into a message at setup time.

A Supabase branch would have covered both. Branching needs the Pro plan.

None of the three problems the deploy turned up would have been caught by any
of that, and it is worth being honest about why: all three were differences
between a bare PostgreSQL and Supabase specifically, and the test suite runs
against a bare PostgreSQL. The checks now at the top of 0021 and the foot of
0030 are the answer — not more tests, but assertions inside the migrations,
which run wherever the migrations run.

### The third one, which was the expensive one

`signatures_register_device`, the trigger 0021 puts on `signatures`, was left
SECURITY INVOKER. It therefore ran as `anon`, and the same migration revokes
everything on `signature_devices` from `anon`. Every attempt to sign raised
`permission denied for table signature_devices`, and because a trigger's
failure rolls back the statement that fired it, the signature row went with
it. **Nobody could make a mark from the moment 0021 reached production**, which
is to say nobody could do anything at all — signing is the gate to the whole
product. It went unnoticed for three days because the deploy verified the
schema, not the flow.

The lesson is narrower than "test more". A bare PostgreSQL has no `anon`, and
every privilege check in that file passes trivially as the owner. The class of
bug is invisible without the role, so 0030 ends by doing the thing the client
does — `set local role anon`, insert a signature, assert the device row landed,
clean up — inside the migration. Anything that breaks signing again fails
there rather than in front of somebody trying to sign.

Worth repeating for the next migration that adds a trigger: `signatures` is the
only table the client writes to directly. Everything else goes through a
definer RPC, where triggers already run as the owner. A trigger on `signatures`
is the one place this matters.

## What is still outstanding

**Notifications are deployed but not sending.** The sender is up (§2) and
nothing is scheduled — `notify_health()` reports `scheduled: false`, 0 pending,
0 subscriptions. Nothing is lost while it is off; that is what the queue is
for, and it is empty because no canvas has closed since the deploy.

Two things are still needed, and both are decisions or credentials rather than
code:

- **The function secrets.** The VAPID keypair and the shared secret. The
  management API *does* have an endpoint for these — `POST
  /v1/projects/{ref}/secrets` — so an earlier note here saying there was no
  equivalent was wrong. What is true is narrower: it needs a personal access
  token, and the deploy session had none and could not reach `api.supabase.com`
  or `*.supabase.co` at all. Hence the CLI or the dashboard.
- **A subject address.** VAPID publishes a contact in every push request, for a
  push service to complain to when a project floods it. It should be an address
  meant to be public, which makes it a decision rather than a value that can be
  derived.

The keypair is best generated wherever it is going to be stored. It is a
signing key, and the fewer places it passes through the better —
`scripts/setup-notify.sh` generates it, pipes it straight into `secrets set`,
and never writes it down.

Then `VITE_VAPID_PUBLIC_KEY` goes into Vercel and the client redeploys. Until
it does, `/mark` says the build has no push behind it, which is true.
