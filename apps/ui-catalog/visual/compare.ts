import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { RegSuitCore } from "reg-suit-core";
import { imageName, resultSchema } from "./report.ts";

const root = resolve(process.env.VISUAL_DIR ?? ".visual");
for (const side of ["actual", "expected"]) {
  const files = await readdir(resolve(root, side), { withFileTypes: true });
  if (files.length === 0) throw new Error(`Empty ${side} capture; refusing a false baseline`);
  for (const file of files) {
    imageName.parse(file.name);
    if (!file.isFile()) throw new Error(`Non-file capture: ${file.name}`);
  }
}
await rm(resolve(root, "report"), { recursive: true, force: true });
await mkdir(resolve(root, "report"), { recursive: true });
await cp(resolve(root, "expected"), resolve(root, "report/expected"), { recursive: true });
const configFileName = resolve(root, "regconfig.json");
await Bun.write(configFileName, JSON.stringify({
  core: { workingDir: resolve(root, "report"), actualDir: resolve(root, "actual"), thresholdRate: 0, ximgdiff: { invocationType: "none" } },
  plugins: {},
}));
const processor = new RegSuitCore({ configFileName }).createProcessor();
const { comparisonResult } = await processor.compare({ expectedKey: "base" });
await Bun.write(resolve(root, "result.json"), JSON.stringify(resultSchema.parse(comparisonResult), null, 2));
