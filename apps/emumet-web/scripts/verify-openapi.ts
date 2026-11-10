/**
 * Usage: bun scripts/verify-openapi.ts
 *
 * Offline check that openapi/emumet.json still matches the producer pin in
 * openapi/producer.lock.json. Exits non-zero on any mismatch.
 */
import { OpenApiLockError, verifyLock } from "../bff/openapi/lock.ts";

try {
  const lock = await verifyLock();
  console.log(`OpenAPI schema OK: ${lock.producer.repository}@${lock.producer.commit} sha256:${lock.schema.sha256}`);
} catch (error) {
  if (error instanceof OpenApiLockError) {
    console.error(`OpenAPI lock check failed: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
