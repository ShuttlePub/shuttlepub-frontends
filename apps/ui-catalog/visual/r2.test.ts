import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { RegSuitCore } from "reg-suit-core";

test("uploads gzip report with correct content types and no ACL via the real S3 plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "catalog-r2-"));
  const uploads: { path: string; acl: string | null; type: string | null; encoding: string | null; content: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      uploads.push({
        path: new URL(req.url).pathname, acl: req.headers.get("x-amz-acl"),
        type: req.headers.get("content-type"), encoding: req.headers.get("content-encoding"),
        content: gunzipSync(Buffer.from(await req.arrayBuffer())).toString(),
      });
      return new Response(null, { status: 200, headers: { ETag: '"test"' } });
    },
  });
  try {
    await Bun.write(join(root, "report/index.html"), "<html>report</html>");
    const configFileName = join(root, "regconfig.json");
    await Bun.write(configFileName, JSON.stringify({
      core: { workingDir: join(root, "report"), actualDir: join(root, "actual") },
      plugins: { "reg-publish-s3-plugin": {
        bucketName: "test-bucket", enableACL: false, pathPrefix: "ui-catalog", customDomain: "visual.example",
        sdkOptions: { endpoint: server.url.href, region: "auto", forcePathStyle: true,
          credentials: { accessKeyId: "test-only", secretAccessKey: "test-only" } },
      } },
    }));
    const processor = new RegSuitCore({ configFileName }).createProcessor();
    const published = await processor.publish({ expectedKey: "base", actualKey: "run-1", comparisonResult: {
      failedItems: [], newItems: [], deletedItems: [], passedItems: [], expectedItems: [], actualItems: [], diffItems: [],
      actualDir: "actual", expectedDir: "expected", diffDir: "diff",
    } });
    expect(published.reportUrl).toBe("https://visual.example/ui-catalog/run-1/index.html");
    expect(uploads).toContainEqual({ path: "/test-bucket/ui-catalog/run-1/index.html", acl: null,
      type: "text/html", encoding: "gzip", content: "<html>report</html>" });
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
