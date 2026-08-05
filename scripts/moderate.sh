#!/usr/bin/env bash
#
# The moderation queue, and the two levers.
#
# Reports have to land somewhere a person actually looks, and that somewhere
# should be one command rather than a dashboard nobody opens. This reads the
# queue and performs the only three things this product can do about a report:
# hide a layer, unlist a canvas, or decide it is fine and say so.
#
# It goes through the same functions the database exposes to the service role
# rather than writing to the tables, so every action is recorded in
# `moderation_actions` and the reports it answers are resolved in the same
# breath. Nothing here deletes anything. There is no command that could.
#
# Connection comes from DATABASE_URL — the same session-pooler string the
# nightly backup uses, and it is never printed.
#
# Usage:
#   scripts/moderate.sh queue                     what is outstanding
#   scripts/moderate.sh show <canvas-id>          a canvas and its hands
#   scripts/moderate.sh hide <layer-id> [note]    stop serving one hand
#   scripts/moderate.sh unhide <layer-id> [note]
#   scripts/moderate.sh unlist <canvas-id> [note] off the gallery shelf
#   scripts/moderate.sh list <canvas-id> [note]
#   scripts/moderate.sh dismiss <canvas-id> [layer-id]   looked, it is fine
#   scripts/moderate.sh log                       what has been done
#
set -Eeuo pipefail

PSQL="${PSQL:-psql}"
CMD="${1:-queue}"
ARG="${2:-}"
NOTE="${3:-}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat >&2 <<'EOF'
FAIL: DATABASE_URL is not set.

Use the same session pooler string the backup uses — Supabase dashboard,
Project Settings → Database → Connection string → Session. It is never stored
by this script and never printed.

  DATABASE_URL='postgresql://...' scripts/moderate.sh queue
EOF
  exit 1
fi

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

redact() { sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#g'; }

fail() {
  echo "" >&2
  echo "MODERATION COMMAND FAILED: $1" >&2
  if [[ -s "$ERR" ]]; then
    echo "" >&2
    echo "  what postgres actually said:" >&2
    redact < "$ERR" | sed 's/^/    /' >&2
  fi
  exit 1
}

run() { "$PSQL" "$DATABASE_URL" -X -v ON_ERROR_STOP=1 "$@" 2>"$ERR" || fail "$CMD"; }

# A uuid, or nothing. Catching this here means a typo is a sentence rather than
# a postgres syntax error.
require_uuid() {
  [[ "$1" =~ ^[0-9a-fA-F-]{36}$ ]] \
    || { echo "FAIL: '$1' is not an id. $2" >&2; exit 1; }
}

case "$CMD" in
  queue)
    echo "Outstanding reports — most-reported first."
    echo ""
    run -c "
      select
        coalesce(layer_id::text, '(whole canvas)') as thing,
        devices,
        reports,
        seed_word as seed,
        slot_count as fmt,
        coalesce(slot_index::text, '-') as slot,
        case when layer_id is null then (case when listed then 'listed' else 'unlisted' end)
             else (case when hidden then 'hidden' else 'served' end) end as state,
        canvas_id,
        to_char(last_reported, 'YYYY-MM-DD HH24:MI') as last
      from public.moderation_queue"
    echo "To act:  scripts/moderate.sh hide <layer-id>   |   unlist <canvas-id>   |   dismiss <canvas-id> [layer-id]"
    ;;

  show)
    require_uuid "$ARG" "Pass a canvas id."
    run -c "
      select seed_word, status, slot_count, slots_filled, listed,
             to_char(created_at, 'YYYY-MM-DD HH24:MI') as opened
        from public.canvases where id = '$ARG'"
    run -c "
      select l.slot_index as slot, l.id as layer_id, l.hidden, l.ink_used as ink,
             jsonb_array_length(l.strokes -> 'strokes') as strokes,
             to_char(l.submitted_at, 'YYYY-MM-DD HH24:MI') as at,
             (select count(*) from public.reports r where r.layer_id = l.id) as reports
        from public.layers l
       where l.canvas_id = '$ARG'
       order by l.slot_index"
    ;;

  hide|unhide)
    require_uuid "$ARG" "Pass a layer id — 'show <canvas-id>' lists them."
    run -tAc "select public.${CMD}_layer('$ARG', $( [[ -n "$NOTE" ]] && echo "'${NOTE//\'/\'\'}'" || echo 'null' ))"
    echo "${CMD}: layer $ARG"
    echo "The row is still in the ledger. This only changes whether it is served."
    ;;

  unlist|list)
    require_uuid "$ARG" "Pass a canvas id."
    listed=$( [[ "$CMD" == "list" ]] && echo true || echo false )
    run -tAc "select public.set_canvas_listed('$ARG', $listed, $( [[ -n "$NOTE" ]] && echo "'${NOTE//\'/\'\'}'" || echo 'null' ))"
    echo "${CMD}: canvas $ARG"
    echo "It keeps its URL either way. This is only whether it is on the shelf."
    ;;

  dismiss)
    require_uuid "$ARG" "Pass a canvas id."
    layer='null'
    if [[ -n "$NOTE" ]]; then
      require_uuid "$NOTE" "The second argument to dismiss is an optional layer id."
      layer="'$NOTE'"
    fi
    n="$(run -tAc "select public.dismiss_reports('$ARG', $layer, null)")"
    echo "dismissed ${n// /} report(s). They stay in the table; they leave the queue."
    ;;

  log)
    run -c "
      select to_char(acted_at, 'YYYY-MM-DD HH24:MI') as at, action,
             coalesce(layer_id::text, canvas_id::text) as target, note
        from public.moderation_actions
       order by acted_at desc limit 40"
    ;;

  *)
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
