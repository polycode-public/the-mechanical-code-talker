#!/usr/bin/env bash
# Builds the container image from the prebuilt bundles/seeds already on
# disk (build:row-service, build:turn-service, build:news-worker,
# build:seed-sqlite — this script does not run them itself), then probes
# each of the three Lambda handlers through the AWS Lambda Runtime
# Interface Emulator (RIE): boots each with the RIE as entrypoint wrapper
# and the CDK's own per-function CMD, invokes it, and checks the response
# came back as structured JSON rather than a hang or a crash.
set -euo pipefail
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE_TAG="${IMAGE_TAG:-tmct-lambda-verify:local}"
RIE_DIR="${RIE_DIR:-$HOME/.aws-lambda-rie}"
RIE_BIN="$RIE_DIR/aws-lambda-rie"
LOG_DIR="${VERIFY_LOG_DIR:-/tmp/tmct-verify-image}"
mkdir -p "$LOG_DIR"

REQUIRED_INPUTS=(
  server/row-service/dist/handler.mjs
  server/turn-service/dist/handler.mjs
  server/news-worker/dist/handler.mjs
  server/seeds/mid-seed.sqlite
  server/seeds/xl-seed.sqlite
)
for f in "${REQUIRED_INPUTS[@]}"; do
  if [ ! -f "$f" ]; then
    echo "missing prebuilt input: $f" >&2
    echo "build it first: npm run build:row-service; npm run build:turn-service; npm run build:news-worker; npm run build:seed-sqlite" >&2
    exit 1
  fi
done

echo "== docker build =="
docker build -t "$IMAGE_TAG" "$ROOT"

IMAGE_SIZE_BYTES="$(docker image inspect "$IMAGE_TAG" --format '{{.Size}}')"
echo "== image size: $((IMAGE_SIZE_BYTES / 1024 / 1024)) MB =="

if [ ! -x "$RIE_BIN" ]; then
  echo "== fetching aws-lambda-rie =="
  mkdir -p "$RIE_DIR"
  ARCH="$(docker version --format '{{.Server.Arch}}')"
  case "$ARCH" in
    arm64)
      RIE_URL="https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie-arm64"
      ;;
    *)
      RIE_URL="https://github.com/aws/aws-lambda-runtime-interface-emulator/releases/latest/download/aws-lambda-rie"
      ;;
  esac
  curl -sSL -o "$RIE_BIN" "$RIE_URL"
  chmod +x "$RIE_BIN"
fi

# Dummy identity so the AWS SDK's credential/region resolution fails fast
# on a real (rejected) call instead of stalling on IMDS lookups — this
# script proves the image and entrypoint work, not real AWS connectivity.
RUN_ENV=(
  -e "AWS_REGION=eu-west-2"
  -e "AWS_ACCESS_KEY_ID=verify"
  -e "AWS_SECRET_ACCESS_KEY=verify"
  -e "AWS_EC2_METADATA_DISABLED=true"
  -e "TABLE_NAME=tmct-verify-table"
)

probe() {
  local service="$1" port="$2" event="$3"
  local container="tmct-rie-verify-$service"
  local response_file="$LOG_DIR/$service-response.json"
  local logs_file="$LOG_DIR/$service-logs.log"

  docker rm -f "$container" >/dev/null 2>&1 || true
  docker run -d --rm --name "$container" \
    "${RUN_ENV[@]}" \
    -v "$RIE_DIR:/aws-lambda" \
    -p "$port:8080" \
    --entrypoint /aws-lambda/aws-lambda-rie \
    "$IMAGE_TAG" \
    /usr/local/bin/npx aws-lambda-ric "$service/handler.handler" >/dev/null

  local endpoint="http://localhost:$port/2015-03-31/functions/function/invocations"
  local ready=""
  for _ in $(seq 1 30); do
    if curl -sf -o /dev/null -X POST "$endpoint" -d '{}'; then
      ready=1
      break
    fi
    sleep 1
  done
  if [ -z "$ready" ]; then
    echo "$service: RIE endpoint never came up" >&2
    docker logs "$container" 2>&1 | tee "$logs_file" >&2
    docker rm -f "$container" >/dev/null 2>&1 || true
    return 1
  fi

  curl -sS -X POST "$endpoint" -d "$event" | tee "$response_file"
  echo
  docker logs "$container" > "$logs_file" 2>&1
  docker rm -f "$container" >/dev/null 2>&1 || true

  if ! python3 -c "import json,sys; json.load(open('$response_file'))" 2>/dev/null; then
    echo "$service: response body is not valid JSON — see $response_file" >&2
    return 1
  fi
  echo "$service: OK — response is valid JSON, logs in $logs_file"
}

HTTP_EVENT='{"requestContext":{"http":{"method":"GET"}},"rawPath":"/","headers":{},"queryStringParameters":{}}'
WORKER_EVENT='{}'

echo "== row-service probe =="
probe row-service 9000 "$HTTP_EVENT"

echo "== turn-service probe =="
probe turn-service 9001 "$HTTP_EVENT"

echo "== news-worker probe =="
probe news-worker 9002 "$WORKER_EVENT"

echo "== news-worker init-done line =="
INIT_DONE_LINE="$(grep -o '"event":"init-done".*' "$LOG_DIR/news-worker-logs.log" || true)"
if [ -z "$INIT_DONE_LINE" ]; then
  echo "init-done line not found in $LOG_DIR/news-worker-logs.log" >&2
  exit 1
fi
echo "$INIT_DONE_LINE"

echo "== verify-image-local: all three handlers responded, seed opened as sqlite =="
