#!/usr/bin/env bash
# Resume (or start) the Wikidata full entity dump download for the
# wikidata-slice corpus band, with a progress line every minute. Safe to
# re-run any time: curl continues from whatever bytes are already on disk,
# and a completed file is a no-op.
#
#   bash scripts/resume-wikidata-dump.sh            # default target dir
#   bash scripts/resume-wikidata-dump.sh /some/dir  # custom target dir
#
# The target lives OUTSIDE /tmp on purpose: the download runs for many hours
# and must survive reboots and session cleanups. When it finishes, the next
# steps are in PLAN_MEMORY_ROLLOUT.md section 4 (the two filter passes, the
# band build, and the load).
#
# The first run PINS a dated dump (…/entities/YYYYMMDD/wikidata-YYYYMMDD-all.json.gz)
# into a .pinned file beside the target, and every resume reads the pin.
# Resuming against latest-all.json.gz is how a multi-day download splices two
# different dump versions into one corrupt file: the symlink moves when
# Wikimedia regenerates the dump, the byte-count check happily matches the
# NEW version's size, and the seam only surfaces as a Z_DATA_ERROR deep into
# the first decompressing read.
set -euo pipefail

ENTITIES_BASE="https://dumps.wikimedia.org/wikidatawiki/entities"
TARGET_DIR="${1:-$HOME/tmct-dumps}"
PIN_FILE="$TARGET_DIR/wikidata-dump.pinned"
TICK_SECONDS=60

mkdir -p "$TARGET_DIR"

size_of() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1" 2>/dev/null || echo 0; }

if [ -f "$PIN_FILE" ]; then
  DUMP_URL=$(cat "$PIN_FILE")
else
  # Newest dated directory whose -all.json.gz actually answers; the newest
  # listing entry can be mid-generation, so fall back through the list.
  DUMP_URL=""
  for DATE in $(curl -sS "$ENTITIES_BASE/" | grep -oE '[0-9]{8}' | sort -run); do
    CANDIDATE="$ENTITIES_BASE/$DATE/wikidata-$DATE-all.json.gz"
    if curl -sIf "$CANDIDATE" >/dev/null 2>&1; then DUMP_URL="$CANDIDATE"; break; fi
  done
  if [ -z "$DUMP_URL" ]; then
    echo "no dated dump found under $ENTITIES_BASE/ — check the listing by hand." >&2
    exit 1
  fi
  printf '%s\n' "$DUMP_URL" > "$PIN_FILE"
fi

TARGET="$TARGET_DIR/$(basename "$DUMP_URL")"

EXPECTED=$(curl -sI "$DUMP_URL" | tr -d '\r' | awk 'tolower($1)=="content-length:" {print $2}')
HAVE=$([ -f "$TARGET" ] && size_of "$TARGET" || echo 0)

if [ -n "$EXPECTED" ] && [ "$HAVE" = "$EXPECTED" ]; then
  echo "already complete: $TARGET ($HAVE bytes)"
  exit 0
fi

echo "target:    $TARGET"
echo "have:      $HAVE bytes"
echo "expected:  ${EXPECTED:-unknown} bytes"
echo "resuming — a progress line prints every ${TICK_SECONDS}s; re-run this script after any interruption."
echo

curl -sS -L -C - -o "$TARGET" "$DUMP_URL" &
CURL_PID=$!

LAST=$HAVE
LAST_T=$(date +%s)
while kill -0 "$CURL_PID" 2>/dev/null; do
  sleep "$TICK_SECONDS"
  kill -0 "$CURL_PID" 2>/dev/null || break
  NOW=$(size_of "$TARGET")
  NOW_T=$(date +%s)
  RATE=$(( (NOW - LAST) / (NOW_T - LAST_T + 1) ))
  if [ -n "$EXPECTED" ] && [ "$RATE" -gt 0 ]; then
    PCT=$(( NOW * 100 / EXPECTED ))
    ETA_MIN=$(( (EXPECTED - NOW) / RATE / 60 ))
    printf '%s  %d bytes (%d%%)  %.1f MB/s  ~%d min left\n' \
      "$(date +%H:%M:%S)" "$NOW" "$PCT" "$(echo "$RATE" | awk '{print $1/1048576}')" "$ETA_MIN"
  else
    printf '%s  %d bytes\n' "$(date +%H:%M:%S)" "$NOW"
  fi
  LAST=$NOW
  LAST_T=$NOW_T
done

wait "$CURL_PID"

HAVE=$(size_of "$TARGET")
if [ -n "$EXPECTED" ] && [ "$HAVE" != "$EXPECTED" ]; then
  echo "incomplete: $HAVE of $EXPECTED bytes — re-run this script to continue." >&2
  exit 1
fi
echo "done: $TARGET ($HAVE bytes). Next steps: PLAN_MEMORY_ROLLOUT.md section 4."
