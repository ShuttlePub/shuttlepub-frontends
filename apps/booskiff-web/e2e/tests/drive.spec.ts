import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { MINIO_HOST, acceptDialogs, folderRow, loginViaUi, runId } from "./helpers";

const folderName = `f-${runId}`;
const renamedFolderName = `pics-${runId}`;
const fileName = "hello.txt";
const helloPath = fileURLToPath(new URL("./assets/hello.txt", import.meta.url));
test.describe.configure({ mode: "serial" });
async function quotaText(page: Page) { return page.getByTestId("quota").textContent(); }
async function createFolder(page: Page, name: string) {
  await page.getByTestId("new-folder-button").click();
  await page.getByTestId("folder-name-input").fill(name);
  await page.getByTestId("folder-create-submit").click();
  await expect(page.getByTestId("folder-list")).toContainText(name);
}

test("empty drive has a single browser, explicit empty state, and quota", async ({ page }) => {
  // Other specs intentionally retain files/folders; use a distinct owner for
  // the empty state instead of depending on global test execution order.
  await loginViaUi(page, `empty-${runId}@example.com`);
  await expect(page.getByTestId("folder-list")).toHaveCount(1);
  await expect(page.getByTestId("file-list")).toHaveCount(1);
  await expect(page.getByTestId("drive-empty")).toBeVisible();
  await expect(page.getByTestId("quota")).toContainText("/");
  await expect(page.getByTestId("folder-name-input")).toHaveCount(0);
});

test("create folder", async ({ page }) => {
  await loginViaUi(page);
  await createFolder(page, folderName);
});

test("upload file updates file list and quota; completed queue remains", async ({ page }) => {
  await loginViaUi(page);
  const before = await quotaText(page);
  await page.getByTestId("upload-input").setInputFiles(helloPath);
  await expect(page.getByTestId("file-list")).toContainText(fileName);
  await expect(page.getByTestId("transfer-panel")).toContainText("完了");
  await expect.poll(() => quotaText(page)).not.toBe(before);
});

test("file detail is SPA navigation and supports direct reload", async ({ page }, testInfo) => {
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
  await page.getByRole("link", { name: "← フォルダに戻る" }).click();
  await expect(page.getByTestId("file-list")).toContainText(fileName);
});

test("nested folders preserve parent structure, breadcrumbs, view preferences, and direct reload", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);
  await folderRow(page, folderName).getByRole("link", { name: folderName, exact: true }).click();
  const parentUrl = page.url();
  await expect(page.getByTestId("file-list")).not.toContainText(fileName);
  await createFolder(page, "Nested");
  await page.getByRole("link", { name: "Nested", exact: true }).click();
  await expect(page.getByTestId("breadcrumbs")).toContainText(`${folderName}Nested`);
  await page.getByTestId("upload-input").setInputFiles({ name: "inside.txt", mimeType: "text/plain", buffer: Buffer.from("inside folder") });
  await expect(page.getByTestId("file-list")).toContainText("inside.txt");
  await page.getByTestId("drive-search").fill("inside");
  await page.getByRole("combobox", { name: "並び順" }).selectOption("size");
  await page.getByTestId("view-grid").click();
  await expect(page.getByTestId("view-grid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("drive-search")).toHaveValue("inside");
  await expect(page.getByRole("combobox", { name: "並び順" })).toHaveValue("size");
  await expect(page.getByTestId("icon-grid")).toHaveText("inside.txt");
  await page.getByRole("link", { name: "inside.txt", exact: true }).click();
  await expect(page.getByTestId("file-detail-page")).toContainText("inside.txt");
  // Queue survives in-app detail navigation.
  await expect(page.getByTestId("transfer-panel")).toContainText("inside.txt");
  await page.getByRole("link", { name: "← フォルダに戻る" }).click();
  await expect(page.getByTestId("view-grid")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByTestId("breadcrumbs")).toContainText("Nested");
  await expect(page.getByTestId("file-list")).toContainText("inside.txt");
  await page.getByTestId("breadcrumbs").getByRole("link", { name: "マイドライブ", exact: true }).click();
  await expect(page.getByTestId("folder-list")).not.toContainText("Nested");
  await expect(page.getByTestId("file-list")).not.toContainText("inside.txt");
  // Nonempty deletion is refused without moving children or files to root.
  await folderRow(page, folderName).getByTestId(/^delete-folder-/).click();
  await expect(page.getByRole("alert")).toContainText("中身があるフォルダは削除できません");
  await page.goto(parentUrl);
  await page.getByRole("link", { name: "Nested", exact: true }).click();
  await page.getByTestId("delete-file-inside.txt").click();
  await expect(page.getByTestId("file-list")).not.toContainText("inside.txt");
  await page.getByTestId("breadcrumbs").getByRole("link", { name: folderName, exact: true }).click();
  await folderRow(page, "Nested").getByTestId(/^delete-folder-/).click();
  await expect(page.getByTestId("folder-list")).not.toContainText("Nested");
});

test("missing file detail shows a not-found state", async ({ page }) => {
  await loginViaUi(page);
  await page.goto("/drive/files/00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("file-detail-page")).toContainText("ファイルが見つかりません");
});

test("download requests an attachment without leaving the app", async ({ page }) => {
  await loginViaUi(page);
  const url = page.url();
  const download = page.waitForEvent("download");
  const presignedRequest = page.context().waitForEvent("request", {
    predicate: (request) => request.url().includes(MINIO_HOST), timeout: 15_000,
  });
  await page.getByTestId(`download-file-${fileName}`).click();
  const presigned = await presignedRequest;
  expect(new URL(presigned.url()).host).toBe(MINIO_HOST);
  await download;
  expect(page.url()).toBe(url);
  await expect(page.getByTestId("transfer-panel")).toContainText("ダウンロードを要求済み");
  await expect(page.getByTestId("transfer-panel")).toContainText("ブラウザで確認");
});

test("rename folder", async ({ page }) => {
  await loginViaUi(page);
  const row = folderRow(page, folderName);
  const renameId = await row.getByTestId(/^rename-folder-/).getAttribute("data-testid");
  if (!renameId) throw new Error("rename button has no stable id");
  const id = renameId.slice("rename-folder-".length);
  await row.getByTestId(/^rename-folder-/).click();
  await page.getByTestId(`folder-rename-input-${id}`).fill(renamedFolderName);
  await page.getByTestId(`folder-rename-save-${id}`).click();
  await expect(page.getByTestId("folder-list")).toContainText(renamedFolderName);
  await expect(page.getByTestId("folder-list")).not.toContainText(folderName);
});

test("delete file updates file list and quota", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);
  const before = await quotaText(page);
  await page.getByTestId(`delete-file-${fileName}`).click();
  await expect(page.getByTestId("file-list")).not.toContainText(fileName);
  await expect.poll(() => quotaText(page)).not.toBe(before);
});

test("delete empty folder", async ({ page }) => {
  await loginViaUi(page);
  acceptDialogs(page);
  await folderRow(page, renamedFolderName).getByTestId(/^delete-folder-/).click();
  await expect(page.getByTestId("folder-list")).not.toContainText(renamedFolderName);
});
