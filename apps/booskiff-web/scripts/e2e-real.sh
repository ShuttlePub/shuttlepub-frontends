#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BOOSKIFF_CORE_DIR="${BOOSKIFF_CORE_DIR:?Set BOOSKIFF_CORE_DIR to a Booskiff checkout}"
REAL_E2E_SECRET="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))')"
REAL_E2E_COOKIE_SECRET="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))')"
export REAL_E2E_SECRET REAL_E2E_COOKIE_SECRET
PROJECT="booskiff-web-real-e2e-$$"
COMPOSE=(docker compose -f "$APP_DIR/e2e/compose.e2e.real.yml" --project-name "$PROJECT")
cleanup() {
  result=$?
  if [[ $result -ne 0 ]]; then
    "${COMPOSE[@]}" logs --no-color --tail 100
  fi
  "${COMPOSE[@]}" down -v --remove-orphans
  exit "$result"
}
docker compose ls
# Fail rather than stopping another checkout's stack or reusing its data.
for port in 3211 3212 4444 19000; do
  if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "Port $port is occupied; stop your own conflicting E2E run first." >&2
    exit 1
  fi
done
trap cleanup EXIT
"${COMPOSE[@]}" up --build --wait --wait-timeout 180
cd "$APP_DIR"
bunx playwright test --config e2e/playwright.real.config.ts "$@"
