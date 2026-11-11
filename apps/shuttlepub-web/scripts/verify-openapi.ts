/**
 * Usage: bun scripts/verify-openapi.ts
 *
 * Offline check that openapi/shuttlepub.json still matches the producer pin in
 * openapi/producer.lock.json, and that the vendored quick reaction scenarios match
 * their lock and come from the same producer commit. Exits non-zero on any mismatch.
 */
import { OpenApiLockError, verifyLock } from "../bff/openapi/lock.ts";
import { verifyScenarioLock } from "../bff/openapi/scenario-lock.ts";

try {
  const lock = await verifyLock();
  console.log(`OpenAPI schema OK: ${lock.producer.repository}@${lock.producer.commit} sha256:${lock.schema.sha256}`);
  const scenarios = await verifyScenarioLock();
  if (scenarios.producer.commit !== lock.producer.commit) {
    throw new OpenApiLockError(`quick reaction scenarios are pinned to ${scenarios.producer.commit}, the schema to ${lock.producer.commit}`);
  }
  console.log(`Quick reaction scenarios OK: ${scenarios.files.length} files from the same commit`);
} catch (error) {
  if (error instanceof OpenApiLockError) {
    console.error(`OpenAPI lock check failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
