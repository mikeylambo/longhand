#!/usr/bin/env bash
#
# Take a real nightly backup out of GitHub and prove it holds the real layers.
#
# Everything about the backup has been verified except the last link. The
# nightly job checks its own dump, and the restore drill has been run — but
# against a dump produced locally, on the same machine, minutes earlier. What
# has never been exercised is the artifact itself: the file that would actually
# be reached for, downloaded from where it actually lives, on a machine that is
# not the one that made it.
#
# That gap is where backups die. Everything upstream can be green while the
# thing you would restore from is a zip you have never opened.
#
#   scripts/verify-artifact.sh                      newest successful run
#   scripts/verify-artifact.sh --run 30987890446    a specific one
#   scripts/verify-artifact.sh --restore            and load it into a local stack
#   scripts/verify-artifact.sh --keep               leave the download in place
#   scripts/verify-artifact.sh --file <dump.gz>     check one you already have
#
# Downloading needs the `gh` CLI, authenticated against this repository.
# Downloads land in a temporary directory and are removed afterwards unless
# --keep is passed, because an archive of other people's drawings should not
# accumulate in a working copy by accident.
#
# --file skips the download and checks a dump on disk, which is how the off-site
# copy gets the same treatment: pull an object out of the bucket and point this
# at it. It is also the only half of this script that can be exercised without
# network access, so it is the half the tests use.
#
set -Eeuo pipefail

REPO="${REPO:-mikeylambo/longhand}"
WORKFLOW="${WORKFLOW:-backup.yml}"
RUN=""
FILE=""
RESTORE=0
KEEP=0
TARGET="${TARGET_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) RUN="${2:-}"; shift 2 ;;
    --file) FILE="${2:-}"; shift 2 ;;
    --restore) RESTORE=1; shift ;;
    --keep) KEEP=1; shift ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

fail() { echo "" >&2; echo "ARTIFACT CHECK FAILED: $1" >&2; exit 1; }

DIR="$(mktemp -d)"
cleanup() { [[ "$KEEP" -eq 1 ]] || rm -rf "$DIR"; }
trap cleanup EXIT

# ------------------------------------------------------------------- fetch

if [[ -n "$FILE" ]]; then
  [[ -f "$FILE" ]] || fail "no such file: $FILE"
  echo "Checking $FILE"
elif ! command -v gh >/dev/null 2>&1; then
  fail "the gh CLI is not installed, so there is nothing to download with.
       brew install gh, then gh auth login — or pass --file <dump.sql.gz> to
       check one you already have."
fi

if [[ -z "$FILE" && -z "$RUN" ]]; then
  RUN="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" \
          --status success --limit 1 --json databaseId \
          --jq '.[0].databaseId' 2>/dev/null || true)"
  [[ -n "$RUN" && "$RUN" != "null" ]] \
    || fail "no successful run of $WORKFLOW found in $REPO.

       If the workflow has never run, the archive has no off-machine backup at
       all yet, whatever the repository says. Run it:

         gh workflow run $WORKFLOW --repo $REPO"
fi

if [[ -n "$FILE" ]]; then
  DUMP="$FILE"
else
  WHEN="$(gh run view "$RUN" --repo "$REPO" --json createdAt --jq '.createdAt' 2>/dev/null || echo unknown)"
  echo "Run $RUN, started $WHEN"

  gh run download "$RUN" --repo "$REPO" --dir "$DIR" >/dev/null 2>&1 \
    || fail "could not download the artifact for run $RUN.

       Artifacts expire after 30 days. If this run is older than that, its
       artifact is gone — which is the retention working, not a failure, but
       it means the off-site copy is the only one left of that night."

  DUMP="$(find "$DIR" -name '*-data.sql.gz' | sort | tail -1)"
  [[ -n "$DUMP" ]] || fail "the artifact contains no *-data.sql.gz. Contents:
$(find "$DIR" -type f | sed 's/^/       /')"
fi

SIZE="$(wc -c < "$DUMP" | tr -d ' ')"
echo "Downloaded $(basename "$DUMP") — $SIZE bytes compressed"
echo ""

# -------------------------------------------------------- rows in the file

# The same COPY-block walk `backup.sh` does, deliberately: if the two ever
# disagree, one of them is reading the format wrong and it matters which.
PLAIN="$DIR/data.sql"
gunzip -c "$DUMP" > "$PLAIN" || fail "the dump does not decompress. That is a corrupt artifact."

count_in_dump() {
  awk -v tbl="public.$1" '
    $0 ~ "^COPY " tbl " " { inside = 1; next }
    inside && $0 == "\\."   { inside = 0 }
    inside                  { count++ }
    END                     { print count + 0 }
  ' "$PLAIN"
}

echo "Rows inside the dump:"
LAYERS=0
for t in canvases layers signatures turns seeds palette_colors; do
  n="$(count_in_dump "$t")"
  printf '  %-16s %s\n' "$t" "$n"
  [[ "$t" == layers ]] && LAYERS="$n"
done

[[ "$LAYERS" -gt 0 ]] \
  || fail "the artifact contains zero layers. Whatever else is in it, the
       archive is not."

# Rows are not drawings. Read the geometry out of the file itself rather than
# trusting that a row with the right shape has anything in it — and read it
# only inside the layers block, because `signatures.stroke_data` is the same
# wire format and would otherwise pad the numbers with marks rather than work.
read -r DRAWN STROKES <<<"$(awk '
  /^COPY public\.layers / { inside = 1; next }
  inside && $0 == "\\."   { inside = 0 }
  inside {
    if ($0 ~ /"strokes"[ ]*:[ ]*\[[ ]*\{/) drawn++
    strokes += gsub(/"p"[ ]*:[ ]*\[/, "")
  }
  END { print drawn + 0, strokes + 0 }
' "$PLAIN")"

echo ""
echo "  layers carrying a drawing     $DRAWN"
echo "  strokes inside them           $STROKES"

[[ "$DRAWN" -eq "$LAYERS" && "$STROKES" -gt 0 ]] \
  || fail "$DRAWN of $LAYERS layer rows actually carry strokes. The rows are
       there and the drawings are not, which is the failure that looks most
       like a working backup."

# ------------------------------------------------------------- the drill

if [[ "$RESTORE" -eq 0 ]]; then
  echo ""
  echo "OK  the artifact holds $LAYERS layer$([[ "$LAYERS" -eq 1 ]] || echo s) with real geometry."
  echo ""
  echo "That is the file proved. To prove it *loads*, build a schema and run"
  echo "the other half — this is the drill that has only ever been run against"
  echo "a local dump:"
  echo ""
  echo "  supabase start && supabase db reset"
  if [[ -n "$FILE" ]]; then
    echo "  scripts/verify-artifact.sh --file $FILE --restore"
  else
    echo "  scripts/verify-artifact.sh --run $RUN --restore"
  fi
  exit 0
fi

echo ""
echo "Restoring it into ${TARGET%%\?*}"
echo ""
CANVASES="$(count_in_dump canvases)"
EXPECT_CANVASES="$CANVASES" EXPECT_LAYERS="$LAYERS" \
  "$(dirname "$0")/restore.sh" "$DUMP" "$TARGET"

echo ""
echo "OK  a real nightly artifact restored — $LAYERS layer$([[ "$LAYERS" -eq 1 ]] || echo s)" \
     "across $CANVASES canvas$([[ "$CANVASES" -eq 1 ]] || echo es)."
