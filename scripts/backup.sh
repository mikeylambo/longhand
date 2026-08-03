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

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y-%m-%d)"
DUMP="$OUT_DIR/longhand-$STAMP-data.sql"
GZ="$DUMP.gz"
SCHEMA="$OUT_DIR/longhand-$STAMP-schema.sql"
SCHEMA_GZ="$SCHEMA.gz"

fail() {
  echo "" >&2
  echo "BACKUP FAILED: $*" >&2
  rm -f "$DUMP" "$GZ" "$SCHEMA" "$SCHEMA_GZ"
  exit 1
}

# ---------------------------------------------------------------- live counts

# Counts are kept in a temp file rather than an associative array: macOS still
# ships bash 3.2, and a backup script that only runs on the CI runner is a
# backup script nobody can rehearse locally.
COUNTS="$(mktemp)"
trap 'rm -f "$COUNTS"' EXIT

live_count() { grep -E "^$1	" "$COUNTS" | cut -f2; }

echo "Reading live row counts…"
for t in "${TABLES[@]}"; do
  n="$("$PSQL" "$DATABASE_URL" -tAc "select count(*) from public.$t" 2>/dev/null)" \
    || fail "could not read public.$t — is DATABASE_URL correct and reachable?"
  printf '%s\t%s\n' "$t" "$n" >> "$COUNTS"
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
  --file="$DUMP" || fail "pg_dump exited non-zero"

[[ -s "$DUMP" ]] || fail "pg_dump produced an empty file"

echo "Dumping schema for reference…"
"$PG_DUMP" "$DATABASE_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --format=plain \
  --file="$SCHEMA" || fail "schema dump exited non-zero"

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

gzip -9 -f "$DUMP" || fail "gzip failed"
gzip -9 -f "$SCHEMA" || fail "gzip failed on the schema dump"
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
