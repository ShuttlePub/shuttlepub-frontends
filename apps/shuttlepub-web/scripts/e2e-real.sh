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
# Host ports of this stack. The defaults are the documented ones; override them only
# to run beside another stack that already holds them (all three must be free).
export SHUTTLEPUB_E2E_WEB_PORT="${SHUTTLEPUB_E2E_WEB_PORT:-3231}"
export SHUTTLEPUB_E2E_PROVIDER_PORT="${SHUTTLEPUB_E2E_PROVIDER_PORT:-3232}"
export SHUTTLEPUB_E2E_HYDRA_PORT="${SHUTTLEPUB_E2E_HYDRA_PORT:-4544}"
PORTS=("$SHUTTLEPUB_E2E_WEB_PORT" "$SHUTTLEPUB_E2E_PROVIDER_PORT" "$SHUTTLEPUB_E2E_HYDRA_PORT")
for port in "${PORTS[@]}"; do
  if ! [[ "$port" =~ ^[1-9][0-9]{2,4}$ ]] || (( port > 65535 )) || [[ "$port" == 4445 || "$port" == 4433 || "$port" == 4434 || "$port" == 8080 ]]; then
    echo "Invalid or reserved E2E port: $port" >&2
    exit 1
  fi
done
if [[ "$(printf '%s\n' "${PORTS[@]}" | sort -u | wc -l)" -ne 3 ]]; then
  echo "E2E ports must differ" >&2
  exit 1
fi
export SHUTTLEPUB_E2E_ORIGIN="http://127.0.0.1:$SHUTTLEPUB_E2E_WEB_PORT"
COMPOSE=(docker compose -f "$APP_DIR/e2e/compose.yml" --project-name "$PROJECT")
for port in "${PORTS[@]}"; do
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
