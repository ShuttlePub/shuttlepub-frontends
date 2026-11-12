/**
 * Usage: bun scripts/verify-openapi.ts
 *
 * Offline check that every vendored OpenAPI schema still matches its producer pin
 * (openapi/shuttlepub.json + producer.lock.json, openapi/emumet.json + emumet.lock.json),
 * and that the vendored quick reaction scenarios match their lock and come from the same
 * ShuttlePub commit as the schema. Exits non-zero on any mismatch.
 */
import { OPENAPI_DIR, OPENAPI_PINS, OpenApiLockError, SHUTTLEPUB_PIN, verifyLock } from "../bff/openapi/lock.ts";
import { verifyScenarioLock } from "../bff/openapi/scenario-lock.ts";

let failed = false;
for (const pin of OPENAPI_PINS) {
  try {
    const lock = await verifyLock(OPENAPI_DIR, pin);
    console.log(`OpenAPI schema OK: ${lock.producer.repository}@${lock.producer.commit} sha256:${lock.schema.sha256}`);
    if (pin === SHUTTLEPUB_PIN) {
      const scenarios = await verifyScenarioLock();
      if (scenarios.producer.commit !== lock.producer.commit) {
        throw new OpenApiLockError(`quick reaction scenarios are pinned to ${scenarios.producer.commit}, the schema to ${lock.producer.commit}`);
      }
      console.log(`Quick reaction scenarios OK: ${scenarios.files.length} files from the same commit`);
    }
  } catch (error) {
    if (!(error instanceof OpenApiLockError)) throw error;
    console.error(`OpenAPI lock check failed (${pin.name}): ${error.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
