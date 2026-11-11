/**
 * Usage: bun scripts/verify-openapi.ts
 *
 * Offline check that every vendored OpenAPI schema still matches its producer pin
 * (openapi/shuttlepub.json + producer.lock.json, openapi/emumet.json + emumet.lock.json).
 * Exits non-zero on any mismatch.
 */
import { OPENAPI_DIR, OPENAPI_PINS, OpenApiLockError, verifyLock } from "../bff/openapi/lock.ts";

let failed = false;
for (const pin of OPENAPI_PINS) {
  try {
    const lock = await verifyLock(OPENAPI_DIR, pin);
    console.log(`OpenAPI schema OK: ${lock.producer.repository}@${lock.producer.commit} sha256:${lock.schema.sha256}`);
  } catch (error) {
    if (!(error instanceof OpenApiLockError)) throw error;
    console.error(`OpenAPI lock check failed (${pin.name}): ${error.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
