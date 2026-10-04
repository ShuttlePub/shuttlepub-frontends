import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDialogs, loginViaUi } from "./helpers";

test("upload beyond the max file size shows an error", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);

  // Playwright rejects setInputFiles buffers >50MB, so the 101MiB payload
  // must arrive as a real temp file.
  const dir = join(tmpdir(), `booskiff-e2e-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, "too-big.bin"), Buffer.alloc(101 * 1024 * 1024));
    await page.getByTestId("upload-input").setInputFiles(join(dir, "too-big.bin"));

    const error = page.getByTestId("file-upload-error");
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText(/size|limit/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/files without a session is rejected as unauthorized", async ({
  request,
}) => {
  const response = await request.post("/api/files", {
    data: { name: "unauthorized.txt" },
  });
  expect(response.status()).toBe(401);
  const body = (await response.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("unauthorized");
});
