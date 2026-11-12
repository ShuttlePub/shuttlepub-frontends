import { expect, test } from "bun:test";
import { join } from "node:path";
import { REST_TYPE_TARGETS, renderRestTypes } from "../../scripts/rest-types.ts";

for (const target of REST_TYPE_TARGETS) {
  test(`${target.path} is exactly what codegen produces from the pinned ${target.pin.name} schema`, async () => {
    const committed = await Bun.file(join(import.meta.dir, "..", "..", target.path)).text();
    expect(committed).toBe(await renderRestTypes(target.pin, target.tags));
    expect(committed).toContain("Do not edit by hand");
  });
}
