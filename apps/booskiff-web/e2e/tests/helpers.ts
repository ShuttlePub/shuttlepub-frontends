import { expect, type Page } from "@playwright/test";

// Email-shaped: the mirrored emumet login view declares type="email", so any
// other string is rejected by native constraint validation before submit.
export const MOCK_IDENTIFIER = "e2e-user@example.com";
export const MOCK_PASSWORD = "password";
export const SESSION_COOKIE_NAME = "booskiff_session";
export const MINIO_HOST = "127.0.0.1:19000";

// Unique per playwright invocation: folders/files never collide with a
// previous run's leftovers on a live stack.
export const runId = Date.now();

export async function loginViaUi(page: Page, identity = MOCK_IDENTIFIER): Promise<void> {
  await page.goto("/login");
  const identifier = page.getByTestId("login-identifier");
  const password = page.getByTestId("login-password");
  const submit = page.getByTestId("login-submit");
  await expect(identifier).toBeVisible();
  await expect(submit).toBeEnabled();
  await identifier.fill(identity);
  await password.fill(MOCK_PASSWORD);
  // The login form is hydrated client-side; a click fired before hydration is
  // inert, so retry the click+wait pair until navigation actually happens.
  await expect(async () => {
    await submit.click();
    await page.waitForURL("**/drive", { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("drive-page")).toBeVisible();
}

// Folder actions are keyed by opaque IDs; identify the semantic table row.
export function folderRow(page: Page, name: string) {
  return page
    .getByTestId("folder-list")
    .locator("tr")
    .filter({ hasText: name })
    .last();
}

// The UI may route deletes through a confirm() dialog; Playwright dismisses
// dialogs by default, which would silently cancel the delete.
export function acceptDialogs(page: Page): void {
  page.on("dialog", (dialog) => {
    void dialog.accept();
  });
}
