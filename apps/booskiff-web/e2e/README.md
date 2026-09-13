# booskiff-web E2E

Playwright suite driving the real stack: booskiff-web (SSR UI + Bun BFF) in
front of a real Booskiff core with Postgres and MinIO. No component is
mocked; the only test fixture is the JWT signing keypair in `fixtures/`.

## Prerequisites

- Docker (compose v2) and Bun
- A Booskiff core checkout (build context for the core image). Default probe:
  `$HOME/Documents/ShuttlePub/Booskiff`, or point `BOOSKIFF_CORE_DIR` at it.
- Playwright browser: `bunx playwright install chromium`

## Running

```bash
cd apps/booskiff-web
scripts/e2e.sh            # full suite
scripts/e2e.sh -g upload  # pass extra playwright args through
```

The script:

1. Resolves `BOOSKIFF_CORE_DIR` (hard-fails with instructions if missing).
2. Generates `e2e/.env.e2e.runtime` (gitignored) from `e2e/fixtures/`:
   `TEST_JWT_PRIVATE_KEY_PEM_BASE64` (base64 of the PKCS8 PEM) and
   `TEST_JWT_JWKS_JSON` (single-line JSON). Compose cannot transform values,
   so this pre-encoded env file is how fixture keys reach the web container.
3. `docker compose -f e2e/compose.e2e.yml up --build --wait` and runs
   `bunx playwright test --config e2e/playwright.config.ts`.
4. Always tears the stack down with `down -v` (fresh state every run).

## Stack contents (`e2e/compose.e2e.yml`, project `booskiff-web-e2e`)

| Service  | Image / build                              | Notes                                       |
| -------- | ------------------------------------------ | ------------------------------------------- |
| postgres | postgres:16                                | no host ports                               |
| minio    | minio/minio (digest pinned in compose.e2e.yml) | `127.0.0.1:19000 -> 19000` (browser-reachable presigned URLs); core shares this netns (`network_mode: service:minio`) so SigV4 presign host matches |
| core     | built from `$BOOSKIFF_CORE_DIR`            | in-network API on the minio alias (`http://minio:8080`); self-creates the bucket at startup, so there is no mc-init service |
| web      | built from `apps/booskiff-web/Containerfile` | `127.0.0.1:3210 -> 3100`                 |

Host-port hygiene: the drive-foundation dev stack owns 5432 and 9000-9001, so
this project publishes only 3210 and 19000, both loopback-only.

## Fixtures (`e2e/fixtures/`)

TEST-ONLY, committed (mirroring Booskiff core's committed test keys):
These public fixtures are not secrets and MUST NOT be trusted by production
issuers or used to sign production tokens. Their private key is intentionally
committed for reproducible local tests, not deployment.
`jwtRS256.pkcs8.pem` + `jwks.json` (`kid: test-key`, matching the BFF signing
key id). Regenerate and
verify with the exact commands in `e2e/fixtures/README.md`; `bun
e2e/fixtures/verify.ts` must print `OK`.

## CI

The `drive-web-e2e` GitHub Actions workflow (defined separately in
`.github/workflows/`) runs `scripts/e2e.sh` with `BOOSKIFF_CORE_DIR` checked
out alongside this repo. The workflow file itself is not part of this
directory.
