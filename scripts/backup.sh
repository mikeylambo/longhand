#!/usr/bin/env bash
#
# Nightly dump of the Longhand archive.
#
# The archive is the asset — append-only, meant to outlive everything else here
# — and the hosting tier it sits on has no automated backups. So this exists.
#
# A backup that silently produces nothing is worse than no backup, because it
# also produces confidence. Checking the file size catches the zero-byte case
# and nothing else: a dump truncated halfway through the layers table is a
# perfectly plausible several hundred kilobytes. So the real check is that every
# table's row count *inside the dump* matches the row count in the live
# database, measured in the same run. Anything short, and this exits non-zero.
#
# Two files come out: the data, and the schema that shaped it.
#
# The data dump is what a restore loads. It is `--data-only` on purpose. A
# combined schema+data dump carries `ALTER DEFAULT PRIVILEGES FOR ROLE
# supabase_admin`, which the role doing the restore is not allowed to execute —
# so the obvious one-file dump is the one that cannot actually be restored into
# a different project. Schema comes from supabase/migrations instead, which is
# verified to build from nothing.
#
# The schema dump is carried anyway so the artifact explains itself years later
# without needing the repo at that commit.
#
# Usage:
#   DATABASE_URL=postgresql://... scripts/backup.sh [output-dir]
#
set -Eeuo pipefail

OUT_DIR="${1:-backups}"
MIN_BYTES="${MIN_BYTES:-2048}"

# Pinned, not "whatever apt has today". Supabase will move to 18 eventually, and
# the point of naming a version is that the move fails on the preflight below
# rather than quietly producing dumps nobody can restore.
PG_MAJOR="${PG_MAJOR:-17}"

# Overridable so CI can point at an explicit /usr/lib/postgresql/<v>/bin path.
# GitHub runners keep several client versions installed at once and PATH order
# is not a promise.
PSQL="${PSQL:-psql}"
PG_DUMP="${PG_DUMP:-pg_dump}"

# Tables whose contents are the archive. A dump missing rows from any of these
# is a failure, not a warning.
TABLES=(canvases layers signatures turns seeds palette_colors)

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "FAIL: DATABASE_URL is not set." >&2
  echo "      In CI this comes from the SUPABASE_DB_URL secret; it must never" >&2
  echo "      be committed. See README, 'Backups'." >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%d)"
DUMP="$OUT_DIR/longhand-$STAMP-data.sql"
GZ="$DUMP.gz"
SCHEMA="$OUT_DIR/longhand-$STAMP-schema.sql"
SCHEMA_GZ="$SCHEMA.gz"

ERR="$(mktemp)"
COUNTS="$(mktemp)"
REPORTED=0
trap 'rm -f "$ERR" "$COUNTS"' EXIT

# A backstop, because `set -e` kills the script at the failing command and says
# nothing. That is how this exited 1 in CI with a blank log after printing six
# perfectly good row counts. Any path that dies without reporting itself is a
# bug in this script, and now it says so and where.
trap 'rc=$?
  if [[ "$REPORTED" -eq 0 ]]; then
    echo "" >&2
    echo "BACKUP FAILED: unexpected error on line $LINENO (exit $rc)." >&2
    echo "  Nothing above explained it, which means this script has a path that" >&2
    echo "  fails without reporting. That is a bug — please fix it there rather" >&2
    echo "  than reading the line number every time." >&2
    rm -f "$DUMP" "$GZ" "$SCHEMA" "$SCHEMA_GZ"
  fi
  exit "$rc"' ERR

# A connection string must never reach a CI log, and postgres does sometimes
# echo one back at you.
redact() { sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#g'; }

# Say what went wrong, then say what postgres said. Replacing the underlying
# error with a friendly guess is how an afternoon disappears into a problem the
# database had already named — this ran unattended for years is the whole
# premise, and it cannot explain itself if it throws the evidence away.
fail() {
  REPORTED=1
  echo "" >&2
  echo "BACKUP FAILED: $1" >&2
  if [[ -n "${2:-}" && -s "${2:-/dev/null}" ]]; then
    echo "" >&2
    echo "  what postgres actually said:" >&2
    redact < "$2" | sed 's/^/    /' >&2
  fi
  rm -f "$DUMP" "$GZ" "$SCHEMA" "$SCHEMA_GZ"
  exit 1
}

psql_value() { # <sql> <what we were doing>
  local out
  if ! out="$("$PSQL" "$DATABASE_URL" -tAXc "$1" 2>"$ERR")"; then
    fail "$2" "$ERR"
  fi
  printf '%s' "$out" | tr -d '[:space:]'
}

# ------------------------------------------------------------------ preflight

# pg_dump refuses to dump a server newer than itself, and it refuses *after*
# connecting — which used to mean this failed halfway through, past the row
# counts, looking like a database problem. Establish it in one round trip
# before anything else happens.

CLIENT_RAW="$("$PG_DUMP" --version 2>"$ERR")" \
  || fail "could not run pg_dump at '$PG_DUMP'. Is the client installed, and is
       the path right? CI sets PG_DUMP explicitly for this reason." "$ERR"
CLIENT_MAJOR="$(printf '%s' "$CLIENT_RAW" | awk '{print $3}' | cut -d. -f1 || true)"

[[ "$CLIENT_MAJOR" =~ ^[0-9]+$ ]] \
  || fail "could not read a version out of: $CLIENT_RAW"

SERVER_NUM="$(psql_value 'show server_version_num' \
  "could not connect to the database. Check DATABASE_URL — for Supabase it must
       be the *session pooler* string, and the username includes the project ref
       (postgres.<ref>), not a bare 'postgres'.")"
SERVER_MAJOR=$((SERVER_NUM / 10000))

echo "pg_dump $CLIENT_MAJOR  ->  server $SERVER_MAJOR  (pinned to $PG_MAJOR)"

if [[ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]]; then
  fail "pg_dump is version $CLIENT_MAJOR but the server is $SERVER_MAJOR, and pg_dump
       cannot dump a server newer than itself.

       In CI: install postgresql-client-$SERVER_MAJOR and point PG_DUMP and PSQL at
       /usr/lib/postgresql/$SERVER_MAJOR/bin/. Locally: brew upgrade libpq."
fi

if [[ "$SERVER_MAJOR" -gt "$PG_MAJOR" ]]; then
  fail "the server is now PostgreSQL $SERVER_MAJOR but this backup is pinned to $PG_MAJOR.

       The database was upgraded under us. Nothing is broken yet — this stopped
       before writing anything — but the pin has to move deliberately: set
       PG_MAJOR=$SERVER_MAJOR here and postgresql-client-$SERVER_MAJOR in the workflow,
       then run a restore drill before trusting the next nightly dump."
fi

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------- live counts

live_count() { # <table> — dies loudly rather than returning empty
  local n
  n="$(awk -v t="$1" '$1 == t { print $2; found = 1 } END { exit !found }' "$COUNTS")" \
    || fail "internal: no row count was recorded for '$1'."
  printf '%s' "$n"
}

echo "Reading live row counts…"
for t in "${TABLES[@]}"; do
  n="$(psql_value "select count(*) from public.$t" "could not read public.$t")"
  [[ "$n" =~ ^[0-9]+$ ]] || fail "public.$t returned '$n', which is not a row count."
  printf '%s %s\n' "$t" "$n" >> "$COUNTS"
  printf '  %-16s %s\n' "$t" "$n"
done

LIVE_LAYERS="$(live_count layers)"
LIVE_CANVASES="$(live_count canvases)"

# An archive with no layers in it is not an archive. This is the one count that
# can never legitimately be zero once the product has been used.
if [[ "$LIVE_LAYERS" -eq 0 && -z "${ALLOW_EMPTY:-}" ]]; then
  fail "the live database reports 0 layers. Refusing to write a backup that would
       overwrite good history with an empty one. If the database really is empty,
       run with ALLOW_EMPTY=1."
fi

# --------------------------------------------------------------------- dump

echo "Dumping data…"
"$PG_DUMP" "$DATABASE_URL" \
  --schema=public \
  --data-only \
  --no-owner \
  --format=plain \
  --file="$DUMP" 2>"$ERR" || fail "pg_dump exited non-zero while dumping data" "$ERR"

[[ -s "$DUMP" ]] || fail "pg_dump produced an empty file"

echo "Dumping schema for reference…"
"$PG_DUMP" "$DATABASE_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --format=plain \
  --file="$SCHEMA" 2>"$ERR" || fail "pg_dump exited non-zero while dumping the schema" "$ERR"

# ------------------------------------------------------- rows actually in it

# pg_dump plain format writes `COPY public.<t> (...) FROM stdin;`, then one line
# per row, then a line containing only `\.`. Backslashes inside the data are
# escaped, so no row can forge that terminator.
echo "Counting rows inside the dump…"
MISMATCH=0
for t in "${TABLES[@]}"; do
  n="$(awk -v tbl="public.$t" '
    $0 ~ "^COPY " tbl " " { inside = 1; next }
    inside && $0 == "\\."   { inside = 0 }
    inside                  { count++ }
    END                     { print count + 0 }
  ' "$DUMP")"
  want="$(live_count "$t")"
  printf '  %-16s %s' "$t" "$n"
  if [[ "$n" -ne "$want" ]]; then
    printf '  <-- expected %s\n' "$want"
    MISMATCH=1
  else
    printf '\n'
  fi
done
[[ "$MISMATCH" -eq 0 ]] || fail "the dump does not contain every row the database reports.
       A truncated dump is the failure mode that looks like a working backup."

# --------------------------------------------------------------- compress

gzip -9 -f "$DUMP" 2>"$ERR" || fail "gzip failed" "$ERR"
gzip -9 -f "$SCHEMA" 2>"$ERR" || fail "gzip failed on the schema dump" "$ERR"
SIZE="$(wc -c < "$GZ" | tr -d ' ')"

if [[ "$SIZE" -lt "$MIN_BYTES" ]]; then
  fail "compressed backup is ${SIZE} bytes, under the ${MIN_BYTES} floor."
fi

# The archive only grows, so a backup much smaller than the last one means
# something was lost even if every count above agreed.
PREV="$(ls -1 "$OUT_DIR"/longhand-*-data.sql.gz 2>/dev/null | grep -v "$(basename "$GZ")" | tail -1 || true)"
if [[ -n "$PREV" ]]; then
  PREV_SIZE="$(wc -c < "$PREV" | tr -d ' ')"
  if [[ "$SIZE" -lt $((PREV_SIZE / 2)) ]]; then
    fail "backup is ${SIZE} bytes, less than half of the previous ${PREV_SIZE}.
       The archive is append-only and should never shrink."
  fi
fi

# ------------------------------------------------------------------ verdict

echo ""
echo "OK  $GZ"
echo "    $SIZE bytes compressed, $LIVE_LAYERS layers across $LIVE_CANVASES canvases"
echo "    $SCHEMA_GZ ($(wc -c < "$SCHEMA_GZ" | tr -d ' ') bytes, reference only)"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "path=$GZ"
    echo "size=$SIZE"
    echo "layers=$LIVE_LAYERS"
    echo "canvases=$LIVE_CANVASES"
  } >> "$GITHUB_OUTPUT"
fi
