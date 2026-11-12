/**
 * Usage: bun scripts/verify-openapi.ts
 *
 * Offline check that every vendored OpenAPI schema still matches its producer pin
 * (openapi/shuttlepub.json + producer.lock.json, openapi/emumet.json + emumet.lock.json),
 * and that the vendored producer fixtures (quick reaction scenarios, personal domain content
 * fixtures) match their locks and come from the same ShuttlePub commit as the schema. Exits non-zero on any mismatch.
 */
import { OPENAPI_DIR, OPENAPI_PINS, OpenApiLockError, SHUTTLEPUB_PIN, verifyLock } from "../bff/openapi/lock.ts";
import { PRODUCER_FIXTURE_SETS, verifyScenarioLock } from "../bff/openapi/scenario-lock.ts";

let failed = false;
for (const pin of OPENAPI_PINS) {
  try {
    const lock = await verifyLock(OPENAPI_DIR, pin);
    console.log(`OpenAPI schema OK: ${lock.producer.repository}@${lock.producer.commit} sha256:${lock.schema.sha256}`);
    if (pin === SHUTTLEPUB_PIN) {
      for (const set of PRODUCER_FIXTURE_SETS) {
        const scenarios = await verifyScenarioLock(set.directory);
        if (scenarios.producer.commit !== lock.producer.commit) {
          throw new OpenApiLockError(`${set.label} are pinned to ${scenarios.producer.commit}, the schema to ${lock.producer.commit}`);
        }
        if (scenarios.producer.path !== set.producerPath) {
          throw new OpenApiLockError(`${set.label} come from ${scenarios.producer.path}, expected ${set.producerPath}`);
        }
        console.log(`${set.label} OK: ${scenarios.files.length} files from the same commit`);
      }
    }
  } catch (error) {
    if (!(error instanceof OpenApiLockError)) throw error;
    console.error(`OpenAPI lock check failed (${pin.name}): ${error.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
