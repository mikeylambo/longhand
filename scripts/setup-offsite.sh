#!/usr/bin/env bash
#
# Wire up the off-site backup destination.
#
# Asks for the four values, proves they actually work against the bucket, and
# only then stores them as GitHub Actions secrets. Proving first matters: a
# typo'd key stored without checking does not announce itself until 03:20
# tomorrow, in a job nobody is watching.
#
# Nothing is echoed, nothing is written to disk, and the values are piped to
# `gh` rather than passed as arguments — argv is visible to anyone who can run
# `ps` on this machine.
#
#   scripts/setup-offsite.sh            # check, then store
#   scripts/setup-offsite.sh --dry-run  # check only
#
set -Eeuo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

AWS="${AWS:-aws}"
say() { printf '%s\n' "$*"; }
die() { printf '\n%s\n' "FAILED: $*" >&2; exit 1; }

command -v "$AWS" >/dev/null || die "the aws CLI is not installed (brew install awscli)."
command -v gh >/dev/null   || die "the gh CLI is not installed."
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run: gh auth login"

cat <<'EOF'
Off-site backup destination
───────────────────────────
The nightly dump already goes to GitHub Actions artifacts. Those protect
against losing the Supabase project — and nothing else, because the repository
and its artifacts live in the same account. This is the copy that survives
losing GitHub.

For Cloudflare R2 you need, from the Cloudflare dashboard:

  R2 → Create bucket             → the bucket name
  R2 → Overview                  → your Account ID (right-hand side)
  R2 → Manage API tokens         → Create token, Object Read & Write,
                                   scoped to that one bucket
                                   → Access Key ID and Secret Access Key

The token only needs read and write on the one bucket. Do not give it account
level access; this job never needs to create or delete a bucket.

Any S3-compatible provider works — Backblaze B2, Wasabi, AWS S3. Give the
matching endpoint when asked and the rest is identical.

EOF

read -r -p "Bucket name: " BUCKET
[[ -n "$BUCKET" ]] || die "a bucket name is required."

read -r -p "Cloudflare Account ID (blank if not R2): " ACCOUNT
if [[ -n "$ACCOUNT" ]]; then
  ENDPOINT="https://${ACCOUNT}.r2.cloudflarestorage.com"
  REGION="auto"
else
  read -r -p "S3 endpoint URL (blank for AWS S3): " ENDPOINT
  read -r -p "Region [auto]: " REGION
  REGION="${REGION:-auto}"
fi

# -s so the key never appears on screen or in scrollback.
read -r -s -p "Access Key ID: " ACCESS_KEY; echo
read -r -s -p "Secret Access Key: " SECRET_KEY; echo
[[ -n "$ACCESS_KEY" && -n "$SECRET_KEY" ]] || die "both key parts are required."

say ""
say "Checking those credentials against s3://$BUCKET …"

export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export AWS_DEFAULT_REGION="$REGION"
export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required

s3() {
  if [[ -n "$ENDPOINT" ]]; then "$AWS" --endpoint-url "$ENDPOINT" s3 "$@"
  else "$AWS" s3 "$@"; fi
}
s3api() {
  if [[ -n "$ENDPOINT" ]]; then "$AWS" --endpoint-url "$ENDPOINT" s3api "$@"
  else "$AWS" s3api "$@"; fi
}

ERR="$(mktemp)"
PROBE="$(mktemp)"
trap 'rm -f "$ERR" "$PROBE"' EXIT
printf 'longhand off-site connectivity probe\n' > "$PROBE"
KEY="longhand/.setup-probe"

# Exactly the four operations the nightly job performs, in order, so anything
# the token cannot do shows up here rather than at 03:20.
s3 cp "$PROBE" "s3://$BUCKET/$KEY" --only-show-errors 2>"$ERR" \
  || { sed 's/^/    /' "$ERR" >&2; die "could not write to the bucket. Check the bucket name, the endpoint, and that the token has Object Read & Write."; }
say "  write   ok"

SIZE="$(s3api head-object --bucket "$BUCKET" --key "$KEY" --query ContentLength --output text 2>"$ERR")" \
  || { sed 's/^/    /' "$ERR" >&2; die "wrote an object but could not read it back."; }
[[ "$SIZE" -gt 0 ]] || die "the object read back as $SIZE bytes."
say "  read    ok"

s3api list-objects-v2 --bucket "$BUCKET" --prefix longhand/ --query 'length(Contents)' --output text >/dev/null 2>"$ERR" \
  || { sed 's/^/    /' "$ERR" >&2; die "cannot list the bucket — pruning would fail every night."; }
say "  list    ok"

s3 rm "s3://$BUCKET/$KEY" --only-show-errors 2>"$ERR" \
  || { sed 's/^/    /' "$ERR" >&2; die "cannot delete — pruning would fail every night."; }
say "  delete  ok"

say ""
if [[ "$DRY_RUN" -eq 1 ]]; then
  say "Dry run: credentials work. Nothing was stored."
  exit 0
fi

say "Storing as GitHub Actions secrets …"
# Piped, never argv.
printf '%s' "$BUCKET"     | gh secret set BACKUP_S3_BUCKET            >/dev/null
printf '%s' "$ACCESS_KEY" | gh secret set BACKUP_S3_ACCESS_KEY_ID     >/dev/null
printf '%s' "$SECRET_KEY" | gh secret set BACKUP_S3_SECRET_ACCESS_KEY >/dev/null
[[ -n "$ENDPOINT" ]] && printf '%s' "$ENDPOINT" | gh secret set BACKUP_S3_ENDPOINT >/dev/null
printf '%s' "$REGION"     | gh secret set BACKUP_S3_REGION            >/dev/null

say ""
gh secret list | grep -E 'BACKUP_S3|SUPABASE_DB' || true
say ""
say "Done. Prove it end to end with:"
say "    gh workflow run backup.yml --ref main"
say ""
say "The run summary should say 'off-site | copied' instead of 'not configured',"
say "and the warning about the archive having only one copy should stop appearing."
