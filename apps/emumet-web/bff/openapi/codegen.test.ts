import { expect, test } from "bun:test";
import { join } from "node:path";
import { REST_TYPES_RELATIVE_PATH, renderRestTypes } from "../../scripts/rest-types.ts";

test("bff/emumet/generated/emumet-api.ts is exactly what codegen produces from the pinned schema", async () => {
  const committed = await Bun.file(join(import.meta.dir, "..", "..", REST_TYPES_RELATIVE_PATH)).text();
  expect(committed).toBe(await renderRestTypes());
  expect(committed).toContain("Do not edit by hand");
});

test("generated REST types cover the RegistrationGate operations and nothing else", async () => {
  const committed = await Bun.file(join(import.meta.dir, "..", "..", REST_TYPES_RELATIVE_PATH)).text();
  expect(committed).toContain('"/api/v1/admin/registration-gate"');
  expect(committed).toContain('"/api/v1/admin/registration-gate/override/revoke"');
  expect(committed).not.toContain('"/api/v1/accounts"');
});
