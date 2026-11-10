import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOCK_FILE, OPENAPI_DIR, OpenApiLockError, SCHEMA_FILE, isCommitSha, parseLock, serializeLock, sha256Hex, verifyLock } from "./lock.ts";

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "emumet-openapi-lock-"));
  await copyFile(join(OPENAPI_DIR, SCHEMA_FILE), join(scratch, SCHEMA_FILE));
  await copyFile(join(OPENAPI_DIR, LOCK_FILE), join(scratch, LOCK_FILE));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("vendored Emumet OpenAPI pin", () => {
  test("the committed schema matches the committed producer pin", async () => {
    const lock = await verifyLock();
    expect(isCommitSha(lock.producer.commit)).toBe(true);
    expect(lock.producer.repository).toBe("ShuttlePub/Emumet");
    expect(lock.schema.sha256).toBe(sha256Hex(new Uint8Array(await Bun.file(join(OPENAPI_DIR, SCHEMA_FILE)).arrayBuffer())));
  });

  test("an edited schema is detected as a checksum mismatch", async () => {
    const original = await readFile(join(scratch, SCHEMA_FILE), "utf8");
    await writeFile(join(scratch, SCHEMA_FILE), original.replace("Emumet Account Service API", "Hand Edited API"));
    await expect(verifyLock(scratch)).rejects.toThrow(/checksum mismatch/);
  });

  test("a lock pointing at different bytes is detected even if the schema is untouched", async () => {
    const lock = parseLock(await readFile(join(scratch, LOCK_FILE), "utf8"));
    await writeFile(join(scratch, LOCK_FILE), serializeLock({ ...lock, schema: { ...lock.schema, sha256: "0".repeat(64) } }));
    await expect(verifyLock(scratch)).rejects.toThrow(OpenApiLockError);
  });

  test("a missing lock or schema fails instead of passing silently", async () => {
    await rm(join(scratch, LOCK_FILE));
    await expect(verifyLock(scratch)).rejects.toThrow(/producer.lock.json is missing/);
    await copyFile(join(OPENAPI_DIR, LOCK_FILE), join(scratch, LOCK_FILE));
    await rm(join(scratch, SCHEMA_FILE));
    await expect(verifyLock(scratch)).rejects.toThrow(/is missing/);
  });

  test("the pin must name a full commit SHA", () => {
    const base = JSON.parse(serializeLock({
      producer: { repository: "ShuttlePub/Emumet", commit: "a".repeat(40), path: "openapi.json" },
      schema: { file: SCHEMA_FILE, sha256: "b".repeat(64), bytes: 1 },
    }));
    expect(() => parseLock(JSON.stringify(base))).not.toThrow();
    for (const commit of ["main", "5827fd5", "A".repeat(40), ""]) {
      expect(() => parseLock(JSON.stringify({ ...base, producer: { ...base.producer, commit } }))).toThrow(OpenApiLockError);
    }
    expect(() => parseLock("{")).toThrow(OpenApiLockError);
  });
});
