import { expect, test } from "@playwright/test";
import { folderRow, loginViaUi, runId } from "./helpers";

// Regression for #19 / #21: an authenticated FULL page load of /drive (SSR +
// resumeMount, then CheckSession -> LoadDrive -> *Loaded patches) must not
// corrupt the client DOM. The observed corruption was duplicated folder
// section elements (folder-create-submit / folder-list rendered twice),
// children leaking between sections, and dead event handlers.
test("authenticated /drive full reload keeps a single, working folder section", async ({
  page,
}) => {
  await loginViaUi(page);

  // Full page load: SSR HTML + resumeMount + session/drive data patches.
  // Register response waits BEFORE the navigation so no patch is missed.
  const filesLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/files") &&
      response.request().method() === "GET",
  );
  const foldersLoaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/folders") &&
      response.request().method() === "GET",
  );
  const billingLoaded = page.waitForResponse(
    (response) => response.url().includes("/api/billing/status"),
  );
  await page.goto("/drive");
  await filesLoaded;
  await foldersLoaded;
  await billingLoaded;
  await expect(page.getByTestId("drive-page")).toBeVisible();

  // Folder section elements must exist exactly once (no duplication).
  await expect(page.getByTestId("folder-create-submit")).toHaveCount(1);
  await expect(page.getByTestId("folder-list")).toHaveCount(1);
  await expect(page.getByTestId("folder-name-input")).toHaveCount(1);

  // Event handlers must survive resume: folder creation still works.
  const name = `resume-${runId}`;
  await page.getByTestId("folder-name-input").fill(name);
  await page.getByTestId("folder-create-submit").click();
  await expect(folderRow(page, name)).toBeVisible({ timeout: 15_000 });
});
