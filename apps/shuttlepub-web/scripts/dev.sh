#!/usr/bin/env bash
# Build / serve script for shuttlepub-web:
#   mock    - fixtures only (SHUTTLEPUB_API_MODE=mock), watch + dev server (default)
#   dev     - real backend (SHUTTLEPUB_API_MODE=real, needs SHUTTLEPUB_API_URL), watch + dev server
#   release - optimized production bundle via purs-backend-es + minify. Build only (no server).
#
# Usage: ./scripts/dev.sh [mock|dev|release]
#
# The data source is chosen by the mode and never changes at runtime: real never
# falls back to mock. Building and the mock mode need no network, backend or other
# repository checkout.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [mock|dev|release]" >&2
  exit 1
fi

MODE="${1:-mock}"

case "$MODE" in
  mock|dev|release) ;;
  *)
    echo "Usage: $0 [mock|dev|release]" >&2
    echo "  mock    - fixtures only, watch + dev server (default)" >&2
    echo "  dev     - real backend (SHUTTLEPUB_API_URL required), watch + dev server" >&2
    echo "  release - optimized production bundle (build only)" >&2
    exit 1
    ;;
esac

bundle_dev() {
  spago bundle --platform browser --module Client --outfile dist/app.js
  spago bundle --platform node --module Server --outfile dist/server.js --bundle-type module
}

bundle_release() {
  echo "==> Building (corefn for purs-backend-es)..."
  spago build

  echo "==> Optimizing with purs-backend-es..."
  purs-backend-es build

  echo "==> Bundling client (esbuild minify)..."
  purs-backend-es bundle-app \
    --no-build \
    --main Client \
    --platform browser \
    --to dist/app.js
  esbuild dist/app.js --bundle --format=esm --minify --legal-comments=none --outfile=dist/app.js --allow-overwrite

  echo "==> Bundling server (esbuild minify)..."
  purs-backend-es bundle-module \
    --no-build \
    --main Server \
    --platform node \
    --to dist/server.js
  esbuild dist/server.js --bundle --format=esm --platform=node --minify --legal-comments=none --outfile=dist/server.js --allow-overwrite
}

bundle_css() {
  local extra=()
  if [[ "$MODE" == "release" ]]; then
    extra+=(--minify)
  fi
  bunx @tailwindcss/cli -i src/style.css -o dist/style.css "${extra[@]}"
}

case "$MODE" in
  mock)
    export SHUTTLEPUB_API_MODE=mock
    ;;
  dev)
    export SHUTTLEPUB_API_MODE=real
    if [[ -z "${SHUTTLEPUB_API_URL:-}" ]]; then
      echo "ERROR: dev mode needs SHUTTLEPUB_API_URL (the ShuttlePub backend base URL)." >&2
      exit 1
    fi
    ;;
esac

# release: build artifacts only, then exit
if [[ "$MODE" == "release" ]]; then
  bundle_release
  bundle_css
  echo "==> Release build complete. Artifacts in dist/. Start with: SHUTTLEPUB_API_MODE=<mock|real> bun index.ts"
  exit 0
fi

# Track only the PIDs we launch so cleanup doesn't kill sibling processes
# (e.g. when run under a wrapping process manager).
CHILD_PIDS=()

cleanup() {
  for pid in "${CHILD_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

bundle_dev
bundle_css

# --postpone: do not run the command at startup; we already did the initial bundle above.
# Watch both .purs sources and spago.yaml / spago.lock so dependency changes trigger rebundle.
watchexec \
  --postpone \
  -w src -w spago.yaml -w spago.lock \
  --filter '*.purs' --filter spago.yaml --filter spago.lock \
  -- \
  "spago bundle --platform browser --module Client --outfile dist/app.js && \
   spago bundle --platform node --module Server --outfile dist/server.js --bundle-type module" &
CHILD_PIDS+=($!)

bunx @tailwindcss/cli -i src/style.css -o dist/style.css --watch=always &
CHILD_PIDS+=($!)

bun index.ts &
BUN_PID=$!
CHILD_PIDS+=("$BUN_PID")

# Wait for any child to exit. If one dies (e.g. bun crashes on port-in-use),
# we tear down the rest immediately rather than appearing to hang.
wait -n
EXIT_CODE=$?
cleanup
exit "$EXIT_CODE"
