import { cp, lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { GetBucketLifecycleConfigurationCommand, S3Client } from "@aws-sdk/client-s3";
import { RegSuitCore } from "reg-suit-core";
import { z } from "zod";
import { commentBody, resultSchema } from "./report.ts";

const root = resolve(process.env.VISUAL_DIR ?? ".visual");
const key = z.string().regex(/^[A-Za-z0-9-]+$/).parse(process.env.VISUAL_KEY);
const revision = z.string().regex(/^[a-f0-9]{7,40}$/).parse(process.env.VISUAL_REVISION);
const result = resultSchema.parse(await Bun.file(resolve(root, "result.json")).json());
const publicOrigin = z.url({ protocol: /^https$/ }).parse(process.env.R2_PUBLIC_URL);
if (new URL(publicOrigin).pathname !== "/") throw new Error("R2_PUBLIC_URL must be an origin without a path");
const reportRoot = `${new URL(publicOrigin).origin}/ui-catalog/${key}`;
// Never publish symlinks from a downloaded artifact (or a local capture).
for (const path of await readdir(resolve(root, "report"), { recursive: true })) {
  if ((await lstat(resolve(root, "report", path))).isSymbolicLink()) throw new Error("Report contains a symlink");
}
if (process.env.LOCAL_STORE) {
  await cp(resolve(root, "report"), resolve(process.env.LOCAL_STORE, "ui-catalog", key), { recursive: true });
} else {
  const env = z.object({
    R2_ENDPOINT: z.url({ protocol: /^https$/ }), R2_BUCKET: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1), R2_SECRET_ACCESS_KEY: z.string().min(1),
  }).parse(process.env);
  const s3 = new S3Client({
    endpoint: env.R2_ENDPOINT, region: "auto", forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  try {
    const lifecycle = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: env.R2_BUCKET }));
    if (!lifecycle.Rules?.some((rule) => rule.Status === "Enabled" &&
      rule.Filter?.Prefix === "ui-catalog/" && rule.Expiration?.Days === 30)) {
      throw new Error("R2 requires an enabled ui-catalog/ expiration rule of 30 days before publishing");
    }
  } finally {
    s3.destroy();
  }
  const configFileName = resolve(root, "regconfig-r2.json");
  await Bun.write(configFileName, JSON.stringify({
    core: { workingDir: resolve(root, "report"), actualDir: resolve(root, "actual") },
    plugins: { "reg-publish-s3-plugin": {
      bucketName: env.R2_BUCKET, enableACL: false, customDomain: new URL(publicOrigin).host,
      pathPrefix: "ui-catalog", sdkOptions: {
        endpoint: env.R2_ENDPOINT, region: "auto", forcePathStyle: true,
        credentials: { accessKeyId: "$R2_ACCESS_KEY_ID", secretAccessKey: "$R2_SECRET_ACCESS_KEY" },
      },
    } },
  }));
  const processor = new RegSuitCore({ configFileName }).createProcessor();
  const comparisonResult = {
    ...result, expectedItems: [...result.passedItems, ...result.failedItems, ...result.deletedItems],
    actualItems: [...result.passedItems, ...result.failedItems, ...result.newItems], diffItems: result.failedItems,
    actualDir: "actual", expectedDir: "expected", diffDir: "diff",
  };
  await processor.publish({ expectedKey: "base", actualKey: key, comparisonResult });
}
await Bun.write(resolve(root, "comment.md"), commentBody(result, reportRoot, revision));
console.info(`Visual report published: ${reportRoot}/index.html`);
