# Getting Phase A, B and C onto production

Production (`uxlhgbvhmukfrhtzzifu`) is at migration **0016**. Everything from
0017 onward is in this repository and nowhere else.

## The order, and why it is that order

**Migrations first, client second.** The client that is live today calls
`claim_turn` with two named arguments, and the four-argument version that 0017
installs still accepts exactly those two. `submit_turn`'s signature never
changes. So the running app keeps working for the whole gap between the two
deploys, and there is no window where the site is broken.

Doing it the other way round breaks the site for as long as the gap lasts: the
new client calls `report_content`, `mint_recovery_key` and `fetch_gallery`,
none of which exist yet on production.

## 1. The schema

```bash
supabase link --project-ref uxlhgbvhmukfrhtzzifu
supabase db push
```

`db push` applies everything the remote is missing, in filename order. Before
you run it, write down what the archive holds, so that afterwards you can say
it is untouched rather than assume it:

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

## 2. Notifications

```bash
scripts/setup-notify.sh
```

Generates the VAPID keypair and the shared secret, stores them, deploys the
sender, proves the endpoint answers with the secret and 404s without it, and
only then schedules the minute-by-minute poke. It prints the public key.

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

All 28 migrations build from nothing against a real PostgreSQL, and 193
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
