import { expect, test } from "@playwright/test";
import { loginViaUi, runId } from "./helpers";

const file = (name: string) => ({ name, mimeType: "text/plain", buffer: Buffer.from("queue regression") });

test("serial queue freezes folder destination and cannot complete before the server response", async ({ page }) => {
  await loginViaUi(page);
  const folderResponse = await page.request.post("/api/folders", { data: { name: `Queue-${runId}` }, headers: { origin: new URL(page.url()).origin } });
  expect(folderResponse.ok()).toBe(true);
  const folder = await folderResponse.json();
  await page.goto(`/drive/folders/${folder.id}`);
  await expect(page.getByTestId("new-menu-button")).toBeEnabled();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const destinations: string[] = [];
  await page.route("**/api/files?*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    destinations.push(new URL(route.request().url()).searchParams.get("folder_id") || "root");
    const response = await route.fetch();
    if (destinations.length === 1) await held;
    await route.fulfill({ response });
  });
  await page.getByTestId("upload-input").setInputFiles([file("queued-first.txt"), file("queued-second.txt")]);
  // Route interception can hold XHR's upload-progress events as well as its
  // response. This browser test proves no premature completion and seriality;
  // test/Upload.test.js separately proves 100% bytes -> saving -> completed.
  await expect(page.getByTestId("transfer-panel")).toContainText("送信中");
  await expect(page.getByTestId("transfer-panel")).toContainText("待機中");
  await expect(page.getByTestId("transfer-panel").getByText("完了", { exact: true })).toHaveCount(0);
  await expect.poll(() => destinations).toEqual([folder.id]);
  await page.getByTestId("transfer-toggle").click();
  await expect(page.getByTestId("transfer-toggle")).toContainText("進行中 1・待機 1");
  await page.getByTestId("breadcrumbs").getByRole("link", { name: "マイドライブ", exact: true }).click();
  await expect(page).toHaveURL(/\/drive$/);
  release();
  await page.getByTestId("transfer-toggle").click();
  await expect(page.getByTestId("transfer-panel").getByText("完了", { exact: true })).toHaveCount(2);
  expect(destinations).toEqual([folder.id, folder.id]);
  await expect(page.getByTestId("file-list")).not.toContainText("queued-first.txt");
  await page.getByTestId("transfer-panel").getByRole("link", { name: `保存先: マイドライブ / ${folder.name}`, exact: true }).first().click();
  await expect(page.getByTestId("file-list")).toContainText("queued-first.txt");
  await expect(page.getByTestId("file-list")).toContainText("queued-second.txt");
});

test("a rejected upload allows later files and explicit retry; network result stays uncertain", async ({ page }) => {
  await loginViaUi(page);
  let rejected = false;
  await page.route("**/api/files?*", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const name = new URL(route.request().url()).searchParams.get("name");
    if (name === "retry.txt" && !rejected) {
      rejected = true;
      return route.fulfill({ status: 429, json: { error: { code: "too_many_requests", message: "retry later" } } });
    }
    if (name === "uncertain.txt") return route.abort("failed");
    return route.continue();
  });
  await page.getByTestId("upload-input").setInputFiles([file("retry.txt"), file("after-rejection.txt"), file("uncertain.txt")]);
  await expect(page.getByTestId("file-list")).toContainText("after-rejection.txt");
  await expect(page.getByTestId("transfer-panel")).toContainText("結果未確認");
  await expect(page.getByTestId("transfer-panel").getByRole("button", { name: "再試行", exact: true })).toHaveCount(1);
  await page.getByTestId("transfer-panel").getByRole("button", { name: "再試行", exact: true }).click();
  await expect(page.getByTestId("file-list")).toContainText("retry.txt");
  await expect(page.getByTestId("transfer-panel").getByRole("button", { name: "再試行", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("transfer-panel")).toContainText("結果未確認");
});

test("drop on the upper addition menu enqueues multiple files into the current folder", async ({ page }) => {
  await loginViaUi(page);
  const dataTransfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["one"], "drop-one.txt", { type: "text/plain" }));
    data.items.add(new File(["two"], "drop-two.txt", { type: "text/plain" }));
    return data;
  });
  await expect(page.getByTestId("new-menu-button")).toBeEnabled();
  await page.getByTestId("new-menu-button").click();
  await page.getByTestId("new-menu").dispatchEvent("drop", { dataTransfer });
  await expect(page.getByTestId("file-list")).toContainText("drop-one.txt");
  await expect(page.getByTestId("file-list")).toContainText("drop-two.txt");
});

test("a delayed pre-save folder snapshot cannot hide a completed upload", async ({ page }) => {
  await loginViaUi(page);
  const created = await page.request.post("/api/folders", {
    data: { name: `Race-${runId}` }, headers: { origin: new URL(page.url()).origin },
  });
  expect(created.ok()).toBe(true);
  const folder = await created.json();
  await page.goto(`/drive/folders/${folder.id}`);
  await expect(page.getByTestId("new-menu-button")).toBeEnabled();
  let releaseUpload!: () => void;
  let releaseSnapshot!: () => void;
  let snapshotRead!: () => void;
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  const snapshotGate = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  const snapshotReady = new Promise<void>((resolve) => { snapshotRead = resolve; });
  let held = false;
  await page.route("**/api/files?*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      await uploadGate;
      return route.continue();
    }
    if (new URL(request.url()).searchParams.get("folder_id") === folder.id && !held) {
      held = true;
      const response = await route.fetch();
      snapshotRead();
      await snapshotGate;
      return route.fulfill({ response });
    }
    return route.continue();
  });
  try {
    await page.getByTestId("upload-input").setInputFiles(file("snapshot-race.txt"));
    await expect(page.getByTestId("transfer-panel")).toContainText("snapshot-race.txt");
    await page.getByTestId("breadcrumbs").getByRole("link", { name: "マイドライブ", exact: true }).click();
    await page.getByTestId("folder-list").getByRole("link", { name: folder.name, exact: true }).click();
    await snapshotReady;
    releaseUpload();
    // Upload completion schedules a newer GET while the old empty response is held.
    await expect(page.getByTestId("file-list")).toContainText("snapshot-race.txt");
    const staleResponse = page.waitForResponse((response) => response.url().includes(`folder_id=${folder.id}`));
    releaseSnapshot();
    await staleResponse;
    await expect(page.getByTestId("file-list")).toContainText("snapshot-race.txt");
  } finally {
    releaseUpload();
    releaseSnapshot();
  }
});
