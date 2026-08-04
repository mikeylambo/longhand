#!/usr/bin/env bash
#
# Restore a Longhand backup, and prove it landed.
#
# A backup nobody has restored is a hypothesis. This is the other half, and it
# is meant to be run for practice, not only in an emergency.
#
# It refuses to restore into the live archive. That is not excessive: this
# script truncates the target before loading, so a mistyped URL would destroy
# exactly the append-only history the backup exists to protect, and would do it
# faster than any other command in this repo.
#
# The dump is data-only, so the target must already have the schema. Apply the
# migrations first — `supabase db reset` locally, or the migrations in order
# against a new project. That is deliberate: a combined schema+data dump carries
# ALTER DEFAULT PRIVILEGES statements the restoring role may not execute, which
# makes the seemingly simpler one-file dump the one that fails when you need it.
#
# Usage:
#   supabase db reset                       # schema, extensions, grants, cron
#   scripts/restore.sh backups/longhand-2026-08-02-data.sql.gz
#   scripts/restore.sh <dump> "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
#
#   EXPECT_CANVASES=1 EXPECT_LAYERS=12 scripts/restore.sh <dump>   # assert too
#
set -Eeuo pipefail

DUMP="${1:-}"
TARGET="${2:-${TARGET_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"
PSQL="${PSQL:-psql}"

# Same list the test suite guards, for the same reason.
PROTECTED_REFS=(uxlhgbvhmukfrhtzzifu rzpjciflydbkpxcimdhb)

if [[ -z "$DUMP" ]]; then
  echo "usage: scripts/restore.sh <dump.sql.gz> [target-database-url]" >&2
  exit 1
fi
[[ -f "$DUMP" ]] || { echo "FAIL: no such dump: $DUMP" >&2; exit 1; }

for ref in "${PROTECTED_REFS[@]}"; do
  if [[ "$TARGET" == *"$ref"* ]]; then
    cat >&2 <<EOF
REFUSED: the target looks like a protected project ($ref).

This script truncates the target before loading. Aimed at the live archive it
would destroy the append-only history the backup exists to protect.

Restore into a local stack, or into a genuinely new project. If you are
rebuilding production after real data loss, do it deliberately by hand — not
through a script with a default target.
EOF
    exit 1
  fi
done

# The schema has to be there already, because the dump only carries rows.
if ! "$PSQL" "$TARGET" -tAc "select to_regclass('public.layers')" | grep -q layers; then
  cat >&2 <<'EOF'
FAIL: the target has no `layers` table.

This dump is data-only. Build the schema first:

  supabase db reset                      # local
  # or apply supabase/migrations/*.sql in order against a new project

then run this again.
EOF
  exit 1
fi

echo "Restoring $(basename "$DUMP")"
echo "     into ${TARGET%%\?*}"
echo ""

# Clear first so a restore is repeatable rather than colliding on primary keys.
# TRUNCATE, never DELETE: it fires statement triggers, so layers_append_only_trg
# is never stood down. Restoring into a database that still holds real history
# is not a thing this script will do quietly — that is what the refusal above is
# for, and why the default target is a local stack.
"$PSQL" "$TARGET" --quiet -v ON_ERROR_STOP=1 -c \
  "truncate public.layers, public.turns, public.canvases, public.signatures,
            public.seeds, public.palette_colors cascade;" >/dev/null

# gunzip -c so the archive on disk is never consumed; a restore must be
# repeatable, including after it goes wrong.
if [[ "$DUMP" == *.gz ]]; then
  gunzip -c "$DUMP" | "$PSQL" "$TARGET" --quiet -v ON_ERROR_STOP=1 >/dev/null
else
  "$PSQL" "$TARGET" --quiet -v ON_ERROR_STOP=1 -f "$DUMP" >/dev/null
fi

echo "Restored. Counting what arrived:"
FAILED=0
read_count() { "$PSQL" "$TARGET" -tAc "select count(*) from public.$1"; }

for t in canvases layers signatures turns seeds palette_colors; do
  printf '  %-16s %s\n' "$t" "$(read_count "$t")"
done

check() { # name expected actual
  if [[ -n "${2:-}" && "$2" != "$3" ]]; then
    echo "  MISMATCH: $1 is $3, expected $2" >&2
    FAILED=1
  fi
}
check canvases "${EXPECT_CANVASES:-}" "$(read_count canvases)"
check layers   "${EXPECT_LAYERS:-}"   "$(read_count layers)"

# Counting rows only proves rows arrived. The archive's value is the stroke
# geometry inside them, so read one back and make sure it is still drawable.
STROKES="$("$PSQL" "$TARGET" -tAc "
  select coalesce(sum(jsonb_array_length(strokes -> 'strokes')), 0) from public.layers")"
POINTS="$("$PSQL" "$TARGET" -tAc "
  select coalesce(sum(jsonb_array_length(s.value -> 'p')) / 4, 0)
    from public.layers l, jsonb_array_elements(l.strokes -> 'strokes') s")"
echo ""
echo "  strokes          $STROKES"
echo "  points           $POINTS"

if [[ "${EXPECT_LAYERS:-0}" -gt 0 && "$STROKES" -eq 0 ]]; then
  echo "  MISMATCH: layers restored but they contain no strokes" >&2
  FAILED=1
fi

# The append-only trigger is part of the schema. A restore that quietly loses it
# would leave an archive that is only append-only by convention.
ARMED="$("$PSQL" "$TARGET" -tAc "
  select coalesce((select tgenabled = 'O' from pg_trigger
    where tgrelid = 'public.layers'::regclass
      and tgname = 'layers_append_only_trg'), false)")"
echo "  append-only      $ARMED"
[[ "$ARMED" == "t" ]] || { echo "  MISMATCH: append-only trigger missing after restore" >&2; FAILED=1; }

echo ""
if [[ "$FAILED" -ne 0 ]]; then
  echo "RESTORE VERIFICATION FAILED" >&2
  exit 1
fi
echo "Restore verified."
