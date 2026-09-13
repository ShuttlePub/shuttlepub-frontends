import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { MINIO_HOST, acceptDialogs, folderRow, loginViaUi, runId } from "./helpers";

const folderName = `f-${runId}`;
const renamedFolderName = `pics-${runId}`;
const fileName = "hello.txt";
const helloPath = fileURLToPath(new URL("./assets/hello.txt", import.meta.url));

// Serial: the tests form one narrative against shared server-side state
// (create -> upload -> download -> rename -> delete), and every run starts
// from a fresh stack (scripts/e2e.sh tears down volumes).
test.describe.configure({ mode: "serial" });

async function quotaText(page: Page): Promise<string | null> {
  return page.getByTestId("quota").textContent();
}

test("empty drive shows list containers and a used/total quota", async ({
  page,
}) => {
  await loginViaUi(page);
  await expect(page.getByTestId("folder-list")).toBeVisible();
  await expect(page.getByTestId("file-list")).toBeVisible();
  await expect(page.getByTestId("quota")).toContainText("/");
});

test("create folder", async ({ page }) => {
  await loginViaUi(page);
  await page.getByTestId("folder-name-input").fill(folderName);
  await page.getByTestId("folder-create-submit").click();
  await expect(page.getByTestId("folder-list")).toContainText(folderName);
});

test("upload file updates file list and quota", async ({ page }) => {
  await loginViaUi(page);
  const quotaBefore = await quotaText(page);

  await page.getByTestId("upload-input").setInputFiles(helloPath);
  await page.getByTestId("upload-submit").click();

  await expect(page.getByTestId("upload-progress")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("file-list")).toContainText(fileName);
  await expect
    .poll(() => quotaText(page), { timeout: 15_000 })
    .not.toBe(quotaBefore);
});

test("file detail supports navigation and direct reload", async ({ page }, testInfo) => {
  await loginViaUi(page);
  await page.getByRole("link", { name: fileName, exact: true }).click();
  await expect(page).toHaveURL(/\/drive\/files\/[^/]+$/);
  await expect(page.getByTestId("file-detail-page")).toContainText("text/plain");
  await page.reload();
  await expect(page.getByTestId("file-detail-page")).toContainText(fileName);
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: testInfo.outputPath(`detail-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: "Drive に戻る" }).click();
  await expect(page.getByTestId("file-list")).toContainText(fileName);
});

test("folder-contained file detail survives direct reload", async ({ page }) => {
  await loginViaUi(page);
  await folderRow(page, folderName).getByRole("button", { name: folderName, exact: true }).click();
  await page.getByTestId("upload-input").setInputFiles({ name: "inside.txt", mimeType: "text/plain", buffer: Buffer.from("inside folder") });
  await page.getByTestId("upload-submit").click();
  const detailResponse = page.waitForResponse((response) => /\/api\/files\/[^/?]+$/.test(response.url()) && response.request().method() === "GET");
  await page.getByRole("link", { name: "inside.txt", exact: true }).click();
  expect((await detailResponse).status()).toBe(200);
  await expect(page.getByTestId("file-detail-page")).toContainText("inside.txt");
  await page.reload();
  await expect(page.getByTestId("file-detail-page")).toContainText("inside.txt");
  await page.getByRole("link", { name: "Drive に戻る" }).click();
  await folderRow(page, folderName).getByRole("button", { name: folderName, exact: true }).click();
  await page.getByTestId("delete-file-inside.txt").click();
  await expect(page.getByTestId("file-list")).not.toContainText("inside.txt");
});

test("missing file detail shows a not-found state", async ({ page }) => {
  await loginViaUi(page);
  await page.goto("/drive/files/00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("file-detail-page")).toContainText("ファイルが見つかりません");
});

test("download file serves the presigned URL", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);

  const presignedRequest = page.context().waitForEvent("request", {
    predicate: (request) => request.url().includes(MINIO_HOST),
    timeout: 15_000,
  });
  await page.getByTestId(`download-file-${fileName}`).click();

  const presigned = await presignedRequest;
  const response = await presigned.response();
  expect(new URL(presigned.url()).host).toBe(MINIO_HOST);
  expect(response?.status()).toBe(200);

  if (page.url().includes(MINIO_HOST)) {
    await page.goBack();
  }
});

test("rename folder", async ({ page }) => {
  await loginViaUi(page);
  const row = folderRow(page, folderName);
  const renameId = await row.getByTestId(/^rename-folder-/).getAttribute("data-testid");
  if (!renameId) throw new Error("rename button has no stable id");
  const folderId = renameId.slice("rename-folder-".length);
  await row.getByTestId(/^rename-folder-/).click();
  await page.getByTestId(`folder-rename-input-${folderId}`).fill(renamedFolderName);
  await page.getByTestId(`folder-rename-save-${folderId}`).click();

  await expect(page.getByTestId("folder-list")).toContainText(renamedFolderName);
  await expect(page.getByTestId("folder-list")).not.toContainText(folderName);
});

test("delete file updates file list and quota", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);
  const quotaBefore = await quotaText(page);

  await page.getByTestId(`delete-file-${fileName}`).click();

  await expect(page.getByTestId("file-list")).not.toContainText(fileName);
  await expect
    .poll(() => quotaText(page), { timeout: 15_000 })
    .not.toBe(quotaBefore);
});

test("delete empty folder", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);

  await folderRow(page, renamedFolderName).getByTestId(/^delete-folder-/).click();

  await expect(page.getByTestId("folder-list")).not.toContainText(
    renamedFolderName,
  );
});
