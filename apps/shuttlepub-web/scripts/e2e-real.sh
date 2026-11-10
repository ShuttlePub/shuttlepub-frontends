#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export EMUMET_CORE_DIR="${EMUMET_CORE_DIR:?Set EMUMET_CORE_DIR to the pinned Emumet checkout}"
EXPECTED_REV="$(<"$APP_DIR/e2e/emumet-revision")"
ACTUAL_REV="$(git -C "$EMUMET_CORE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_REV" != "$EXPECTED_REV" ]]; then
  echo "Emumet revision differs from e2e/emumet-revision" >&2
  exit 1
fi
git -C "$EMUMET_CORE_DIR" diff --quiet HEAD -- Cargo.toml Cargo.lock kernel application driver server migrations
export EMUMET_E2E_IMAGE="shuttlepub-emumet-fa-e2e:${EXPECTED_REV:0:12}"
export REAL_E2E_SECRET
export REAL_E2E_COOKIE_SECRET
REAL_E2E_SECRET="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"))')"
REAL_E2E_COOKIE_SECRET="$(bun -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"))')"
PROJECT="shuttlepub-web-real-e2e-$$-$(bun -e 'console.log(crypto.randomUUID().slice(0,8))')"
COMPOSE=(docker compose -f "$APP_DIR/e2e/compose.yml" --project-name "$PROJECT")
for port in 3231 3232 4544; do
  if (echo >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "Port $port is occupied; refusing to touch another stack." >&2
    exit 1
  fi
done
cleanup() {
  result=$?
  # Never dump raw IdP responses/tokens or credentials into CI logs.
  if [[ $result -ne 0 ]]; then "${COMPOSE[@]}" ps -a; fi
  "${COMPOSE[@]}" down -v --remove-orphans
  exit "$result"
}
trap cleanup EXIT
docker build -f "$APP_DIR/e2e/Emumet.Containerfile" -t "$EMUMET_E2E_IMAGE" "$EMUMET_CORE_DIR"
"${COMPOSE[@]}" up --build --wait --wait-timeout 180
cd "$APP_DIR"
bunx playwright test --config e2e/playwright.config.ts "$@"
if "${COMPOSE[@]}" logs --no-color web | grep -Eq 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|"(access_token|refresh_token|id_token)"[[:space:]]*:'; then
  echo "Token-shaped data detected in BFF logs (contents suppressed)" >&2
  exit 1
fi
