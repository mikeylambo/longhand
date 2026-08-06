#!/usr/bin/env bash
#
# Turn the notification sender on.
#
# The queue has been filling since migration 0022 and nothing has been reading
# it. Three things are missing and all three are secrets, which is why they are
# a script rather than a migration:
#
#   a VAPID keypair   the push services' way of knowing a push came from us
#   a shared secret   so the function is not an open endpoint
#   a schedule        a cron row that pokes the function once a minute
#
# It generates what can be generated, asks for nothing that can be derived, and
# proves the function actually answers before it schedules anything. Proving
# first is the same lesson as the off-site backup: a wrong value stored without
# checking does not announce itself until the first canvas closes, in a job
# nobody is watching.
#
#   scripts/setup-notify.sh                 # generate, deploy, prove, schedule
#   scripts/setup-notify.sh --status        # what is it doing right now
#   scripts/setup-notify.sh --off           # stop sending, keep the queue
#
# Nothing is echoed, nothing is written to disk, and every value is piped
# rather than passed as an argument — argv is visible to anything that can run
# `ps` on this machine.
#
# Two of the steps are SQL against the remote database: scheduling the poke and
# reporting health. The Supabase CLI has no command for running SQL — `db push`
# applies migrations, `db dump` reads, `db diff`/`lint`/`pull`/`reset` are the
# rest, and that is all of it. (An earlier version of this script called
# `supabase db execute`, which has never existed. It failed at the *last* step,
# after the secrets were stored and the sender deployed, and blamed the project
# link for it.) So SQL goes over psql when a connection string is available:
#
#   export SUPABASE_DB_URL='postgresql://…'   # Settings → Database → URI
#
# Without one the statement is printed to paste into the dashboard's SQL
# editor. Each is a single line, and a step that hands you the line is better
# than a step that dies holding it.
#
set -Eeuo pipefail

SUPABASE="${SUPABASE:-supabase}"
say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n' "FAILED: $*" >&2; exit 1; }

MODE="${1:-setup}"

# Only setup needs the CLI and node — the keypair, the secrets and the deploy.
# --status and --off are SQL alone, and asking for a CLI to read a health count
# would be a reason not to check.
if [[ "$MODE" == "setup" ]]; then
  command -v "$SUPABASE" >/dev/null \
    || die "the supabase CLI is not installed (brew install supabase/tap/supabase)."
  command -v node >/dev/null || die "node is not installed."
fi

REF="${SUPABASE_PROJECT_REF:-}"
if [[ -z "$REF" ]]; then
  read -r -p "Supabase project ref (Project Settings → General): " REF
fi
[[ "$REF" =~ ^[a-z]{20}$ ]] || die "'$REF' does not look like a project ref."

FN_URL="https://${REF}.supabase.co/functions/v1/notify"

# ------------------------------------------------------------------ status

# Set by sql() to whether the last statement actually ran, so nothing below
# reports as done what it has really only handed over.
SQL_RAN=0

sql() { # <sql> [what it does] — over psql, or printed to paste
  if [[ -n "${SUPABASE_DB_URL:-}" ]] && command -v psql >/dev/null; then
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -qAtX -c "$1" \
      || die "that statement failed against the database."
    SQL_RAN=1
    return
  fi
  SQL_RAN=0
  # Deliberately not a failure. The caller is mid-setup and the alternative is
  # stopping with the work half done.
  say ""
  say "Run this in the SQL editor — Dashboard → SQL Editor → New query:"
  say ""
  printf '  %s\n' "$1"
  say ""
  # Only wait when something after this depends on it having run.
  if [[ -n "${2:-}" && -t 0 ]]; then
    read -r -p "Press return once $2. " _
  fi
}

if [[ "$MODE" == "--status" ]]; then
  say "Notification health"
  say "───────────────────"
  sql "select jsonb_pretty(public.notify_health());"
  exit 0
fi

if [[ "$MODE" == "--off" ]]; then
  sql "select public.unschedule_notify();"
  if (( SQL_RAN )); then
    say "Stopped. The queue keeps filling and nothing is lost — turn it back on"
    say "and everyone gets the one notification that is still true."
  else
    say "Once that has run the sender is stopped. The queue keeps filling and"
    say "nothing is lost — turn it back on and everyone gets the one"
    say "notification that is still true."
  fi
  exit 0
fi

# ------------------------------------------------------------------- keys

cat <<'EOF'
Notifications
─────────────
Two events and no others: somebody added to a canvas you are on, and a canvas
you are on finished. No digests, no reminders, no nudges to come back.

This needs a VAPID keypair — the thing that lets Apple's and Google's push
services tell that a push came from this project and not from somebody who
copied an endpoint. It is generated here and never leaves this machine except
into Supabase and Vercel.

EOF

say "Generating a keypair…"
KEYS="$(npx --yes web-push@3.6.7 generate-vapid-keys --json)" \
  || die "could not generate VAPID keys."
VAPID_PUBLIC="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicKey)' "$KEYS")"
VAPID_PRIVATE="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).privateKey)' "$KEYS")"
[[ -n "$VAPID_PUBLIC" && -n "$VAPID_PRIVATE" ]] || die "the keypair came back empty."

# A push service needs somewhere to complain to when a project floods it. It is
# published in every push request, so it should be an address that is meant to
# be public.
read -r -p "An address a push service can complain to (mailto:… or https://…): " SUBJECT
[[ "$SUBJECT" =~ ^(mailto:|https://) ]] || die "that has to start with mailto: or https://"

NOTIFY_SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("base64url"))')"

# --------------------------------------------------------------- deploying

say ""
say "Storing the secrets…"
{
  printf 'VAPID_PUBLIC_KEY=%s\n' "$VAPID_PUBLIC"
  printf 'VAPID_PRIVATE_KEY=%s\n' "$VAPID_PRIVATE"
  printf 'VAPID_SUBJECT=%s\n' "$SUBJECT"
  printf 'NOTIFY_SECRET=%s\n' "$NOTIFY_SECRET"
} | "$SUPABASE" secrets set --project-ref "$REF" --env-file /dev/stdin >/dev/null \
  || die "could not store the function secrets."

say "Deploying the sender…"
# --no-verify-jwt because the caller is pg_cron, which has no user session. The
# x-notify-secret header is what actually guards it, and a request without one
# gets a 404 rather than a 401 — an unauthenticated caller should not even
# learn that this endpoint exists.
"$SUPABASE" functions deploy notify --project-ref "$REF" --no-verify-jwt >/dev/null \
  || die "could not deploy the function."

# ----------------------------------------------------------------- proving

say "Checking it answers…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN_URL" \
        -H "x-notify-secret: ${NOTIFY_SECRET}" -H 'Content-Type: application/json' -d '{}')"
[[ "$CODE" == "200" ]] || die "the function answered $CODE rather than 200.
       Check the log: supabase functions logs notify --project-ref $REF"

# And that it is not answering everybody.
OPEN="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$FN_URL" \
        -H 'Content-Type: application/json' -d '{}')"
[[ "$OPEN" == "404" ]] || die "the function answered $OPEN without the secret.
       It should be a 404 to anyone who does not have it. Refusing to schedule
       an endpoint anybody can poke."

say "Scheduling it…"
# This is the one statement with a secret in it. Over psql it never leaves the
# process; pasted, it is on screen for as long as the paste takes. That is the
# cost of not having a CLI that runs SQL, and it is why SUPABASE_DB_URL is
# worth setting.
sql "select public.schedule_notify('${FN_URL}', '${NOTIFY_SECRET}');" \
    "it has run and returned a job id"

# ------------------------------------------------------------- the client

if (( SQL_RAN )); then
  say ""
  say "Done. The sender runs every minute and the queue is draining."
else
  say ""
  say "Secrets stored and the sender deployed and proved. It starts running"
  say "every minute once that last statement has gone through."
fi

cat <<EOF

One thing left, and it has to be you because it is a deploy: the client needs
the public half of the keypair to subscribe a browser at all. Set this in
Vercel — Project → Settings → Environment Variables — for Production and
Preview, then redeploy:

  VITE_VAPID_PUBLIC_KEY=${VAPID_PUBLIC}

Until it is set, /mark says this build has no push behind it, which is true
and is better than a button that fails when somebody taps it.

  scripts/setup-notify.sh --status    what it is doing
  scripts/setup-notify.sh --off       stop sending, keep the queue
EOF
