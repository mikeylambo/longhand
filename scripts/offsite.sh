#!/usr/bin/env bash
#
# Copy the nightly dump somewhere that is not GitHub.
#
# The artifacts are a real backup against losing the Supabase project. They are
# not a backup against losing the GitHub account, because the repo and the
# artifacts share that failure domain entirely. This is the third copy.
#
# S3-compatible on purpose, so the destination is a choice rather than a
# commitment: Cloudflare R2, Backblaze B2, AWS S3, Wasabi, a MinIO box in a
# cupboard. Set BACKUP_S3_ENDPOINT for anything that is not AWS.
#
#   BACKUP_S3_BUCKET            required — bucket name
#   BACKUP_S3_ACCESS_KEY_ID     required
#   BACKUP_S3_SECRET_ACCESS_KEY required
#   BACKUP_S3_ENDPOINT          optional — omit only for AWS S3
#   BACKUP_S3_REGION            optional — default 'auto' (what R2 wants)
#   BACKUP_S3_PREFIX            optional — default 'longhand'
#   OFFSITE_KEEP                optional — default 30
#
# Usage: scripts/offsite.sh backups
#
set -Eeuo pipefail

DIR="${1:-backups}"
KEEP="${OFFSITE_KEEP:-30}"
PREFIX="${BACKUP_S3_PREFIX:-longhand}"
REGION="${BACKUP_S3_REGION:-auto}"
AWS="${AWS:-aws}"

REPORTED=0
fail() {
  REPORTED=1
  echo "" >&2
  echo "OFF-SITE COPY FAILED: $1" >&2
  if [[ -n "${2:-}" && -s "${2:-/dev/null}" ]]; then
    echo "" >&2
    echo "  what the storage API said:" >&2
    sed 's/^/    /' < "$2" >&2
  fi
  exit 1
}

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT
trap 'rc=$?
  if [[ "$REPORTED" -eq 0 ]]; then
    echo "" >&2
    echo "OFF-SITE COPY FAILED: unexpected error on line $LINENO (exit $rc)." >&2
    echo "  Nothing above explained it — that is a bug in this script." >&2
  fi
  exit "$rc"' ERR

# --------------------------------------------------------------- configured?

# Not configured is a different thing from broken. Without a destination this
# says so and stops, and the caller decides whether that is acceptable; with a
# destination that does not work, it fails hard. What it never does is quietly
# succeed having copied nothing.
if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "off-site copy is not configured (no BACKUP_S3_BUCKET) — skipping."
  echo "The archive currently has one copy, in GitHub artifacts, which shares a"
  echo "failure domain with the repository. See README, 'Backups'."
  exit 78 # EX_CONFIG — distinguishable from a real failure
fi

for v in BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
  [[ -n "${!v:-}" ]] || fail "$BACKUP_S3_BUCKET is set but $v is not.
       A half-configured destination is worse than none: it looks deliberate."
done

command -v "$AWS" >/dev/null || fail "the aws CLI is not installed."

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

s3() {
  if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
    "$AWS" --endpoint-url "$BACKUP_S3_ENDPOINT" s3 "$@"
  else
    "$AWS" s3 "$@"
  fi
}
s3api() {
  if [[ -n "${BACKUP_S3_ENDPOINT:-}" ]]; then
    "$AWS" --endpoint-url "$BACKUP_S3_ENDPOINT" s3api "$@"
  else
    "$AWS" s3api "$@"
  fi
}

# ------------------------------------------------------------------- upload

shopt -s nullglob
FILES=("$DIR"/longhand-*.sql.gz)
[[ ${#FILES[@]} -gt 0 ]] || fail "no dumps found in '$DIR'. Run scripts/backup.sh first."

echo "Copying ${#FILES[@]} file(s) to s3://$BACKUP_S3_BUCKET/$PREFIX/"
for f in "${FILES[@]}"; do
  base="$(basename "$f")"
  s3 cp "$f" "s3://$BACKUP_S3_BUCKET/$PREFIX/$base" --only-show-errors 2>"$ERR" \
    || fail "uploading $base failed." "$ERR"

  # Trust nothing: read the size back from the destination and compare. A
  # truncated upload is the same class of problem as a truncated dump.
  want="$(wc -c < "$f" | tr -d ' ')"
  got="$(s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$PREFIX/$base" \
          --query ContentLength --output text 2>"$ERR")" \
    || fail "uploaded $base but could not read it back." "$ERR"
  [[ "$got" == "$want" ]] \
    || fail "$base is $want bytes locally but $got bytes in the bucket."
  printf '  %-40s %s bytes, verified\n' "$base" "$got"
done

# -------------------------------------------------------------------- prune

# Names are longhand-YYYY-MM-DD-{data,schema}.sql.gz, so lexical order is date
# order and the newest KEEP are simply the tail of a sorted list.
# `mapfile` is bash 4 and macOS ships 3.2. A backup script nobody can rehearse
# on their own laptop is not a rehearsed backup.
LIST="$(mktemp)"
s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$PREFIX/" \
  --query 'Contents[].Key' --output text > "$LIST" 2>"$ERR" \
  || fail "could not list the bucket to prune it." "$ERR"

KEYS=()
while IFS= read -r line; do
  [[ -n "$line" && "$line" != "None" ]] && KEYS+=("$line")
done < <(tr '\t' '\n' < "$LIST" | sort)
rm -f "$LIST"

TOTAL=${#KEYS[@]}
# Two files per night, so keep twice the number of days.
KEEP_OBJECTS=$((KEEP * 2))

if [[ "$TOTAL" -le "$KEEP_OBJECTS" ]]; then
  echo "$TOTAL object(s) held, keeping up to $KEEP_OBJECTS — nothing to prune."
else
  DOOMED=$((TOTAL - KEEP_OBJECTS))
  # A normal night removes two. Anything wholesale means the naming or the
  # listing changed shape, and deleting backups on a guess is not a thing this
  # script will do — the operator can look and decide.
  if [[ "$DOOMED" -gt 10 ]]; then
    fail "pruning would delete $DOOMED of $TOTAL objects, which is far more than
       the two a normal night retires. Refusing to guess. Look at
       s3://$BACKUP_S3_BUCKET/$PREFIX/ and clear it by hand if that is right."
  fi
  echo "Pruning $DOOMED object(s) beyond the newest $KEEP days:"
  i=0
  for k in "${KEYS[@]}"; do
    [[ "$i" -lt "$DOOMED" ]] || break
    i=$((i + 1))
    s3 rm "s3://$BACKUP_S3_BUCKET/$k" --only-show-errors 2>"$ERR" \
      || fail "could not delete $k." "$ERR"
    echo "  removed $k"
  done
fi

REMAINING="$(s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$PREFIX/" \
             --query 'length(Contents)' --output text 2>/dev/null || echo '?')"
echo ""
echo "OK  off-site copy holds $REMAINING object(s) at s3://$BACKUP_S3_BUCKET/$PREFIX/"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "offsite_objects=$REMAINING" >> "$GITHUB_OUTPUT"
fi
