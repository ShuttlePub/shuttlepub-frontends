import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import { startBooskiffStub } from "./booskiff-stub.ts";
import { EXPECTED_GRAPHQL_CODES, FIXED_TIME, MOCK_IDENTIFIER, MOCK_PASSWORD, MUTATES_SERVER, SCREEN_CASES, type ScreenApp, type ScreenCase, type ScreenViewer } from "./cases.ts";
import { localImage } from "./fixtures.ts";
import {
  captureSide,
  EMUMET_WEBHOOK_PROBE_SCENARIO,
  featuresFromEmumetScenarioProbe,
  featuresInEmumetHtml,
  featuresInShuttlePubHtml,
  selectCases,
  SHUTTLEPUB_PROBE_PATHS,
  type CaptureSide,
} from "./features.ts";
import { startApp, type AppServer } from "./servers.ts";
import { SHUTTLEPUB_LOOPBACK_SESSION_COOKIE, startShuttlePubStub } from "./shuttlepub-stub.ts";

/** The real-mode viewer a ShuttlePub case is captured as (cases.ts ScreenViewer), if any. */
function viewerOf(item: ScreenCase): ScreenViewer | undefined {
  return "viewer" in item ? item.viewer : undefined;
}

async function prepareScreen(page: Page, item: ScreenCase) {
  const content = page.locator("#content");
  let expectedPath: string = item.path;
  // App chrome/copy changes should produce a visual diff, not make the current
  // driver incompatible with main. Wait for structure and seeded data instead.
  await expect(content.locator("h1")).toBeVisible();
  if (item.id === "login" && item.app !== "ShuttlePub") {
    await expect(content.locator('form input[type="email"]')).toBeVisible();
    await expect(content.locator('form input[type="password"]')).toBeVisible();
    await expect(content.locator('form button[type="submit"]')).toBeVisible();
  } else if (item.id === "not-found") {
    await expect(content.locator("h1 + p")).toBeVisible();
  }
  if (item.app === "Booskiff") {
    if (item.id.startsWith("drive-")) {
      await expect(page.getByTestId("quota")).toContainText(/\d/);
      if (item.data === "empty") {
        // The main baseline has separate empty lists; the hierarchical browser
        // has one empty folder view. Do not require either layout's row tags.
        await expect(content.locator('a[href^="/drive/files/"]')).toHaveCount(0);
        await expect(content.getByText("Projects", { exact: true })).toHaveCount(0);
      } else {
        await expect(content.getByText("Projects", { exact: true })).toBeVisible();
        await expect(content.getByText("Archive", { exact: true })).toBeVisible();
        await expect(content.getByText("README.txt", { exact: true })).toBeVisible();
      }
      if (item.id === "drive-folder") {
        const folderLink = content.locator('a[href="/drive/folders/folder-projects"]');
        if (await folderLink.count()) {
          expectedPath = "/drive/folders/folder-projects";
          await folderLink.click();
        } else {
          await page.getByRole("button", { name: "Projects", exact: true }).click();
        }
        await expect(page.getByTestId("upload-input")).toHaveAttribute("data-folder-id", "folder-projects");
        await expect(content.getByText("design-notes.pdf", { exact: true })).toBeVisible();
        await expect(content.getByText("project-cover.png", { exact: true })).toBeVisible();
        await expect(content.getByText("README.txt", { exact: true })).toHaveCount(0);
      }
    } else if (item.id === "file-detail") {
      await expect(page.getByRole("heading", { name: "design-notes.pdf", exact: true })).toBeVisible();
      await expect(page.getByTestId("file-detail-page").locator('a[href="/api/files/file-design/download"]')).toBeVisible();
    }
  } else if (item.app === "ShuttlePub") {
    const shell = page.getByTestId("app-shell");
    if (await shell.count()) {
      if (viewerOf(item)) await prepareShuttlePubSignedOut(page, item);
      else await prepareShuttlePubShell(page, item);
    } else if (item.id === "home") {
      // F0 foundation placeholder (baseline revisions before the SNS shell).
      // The marker flips only after Flame resumed the SSR DOM, and the three rows
      // fill only from real BFF responses, so this fails if hydration or the
      // GraphQL path is broken. Mock fixture values, not layout, are asserted.
      await expect(page.getByTestId("hydration-state")).toHaveAttribute("data-state", "hydrated");
      await expect(page.getByTestId("api-mode")).toContainText("mock");
      await expect(page.getByTestId("api-status")).toContainText("v1");
      await expect(page.getByTestId("profile-context")).toContainText("Fixture Profile");
    }
  } else {
    if (item.id === "accounts-populated") {
      for (const id of ["acc_01", "acc_02", "acc_03"]) {
        await expect(page.locator(`main a[href="/accounts/${id}"]`)).toBeVisible();
      }
    } else if (item.id === "account-new") {
      // main: a form page with one disabled submit button; username UI: a modal over the list
      await expect(content.locator('input[type="text"]').first()).toBeVisible();
      await expect(content.getByRole("checkbox")).toBeVisible();
      await expect(content.getByRole("button", { name: /^(Create Account|作成)$/ })).toBeDisabled();
    } else if (item.id === "account-new-filled") {
      const fields = content.locator('input[type="text"]');
      await fields.first().fill("release-bot");
      await content.getByRole("checkbox").check();
      if (await fields.count() > 1) {
        await fields.nth(1).fill("release-bot");
        await expect(content.getByText("利用できます")).toBeVisible();
      }
      await expect(content.getByRole("button", { name: /^(Create Account|作成)$/ })).toBeEnabled();
    } else if (item.id === "account-new-invalid") {
      await content.locator('input[type="text"]').first().fill("Release Bot");
      await content.locator("#new-username").fill("Alice");
      await expect(content.getByText("先頭は a〜z か 0〜9")).toBeVisible();
      await expect(content.locator("#new-username")).toHaveValue("Alice");
      await expect(content.getByRole("dialog").getByRole("button", { name: "作成" })).toBeDisabled();
    } else if (item.id === "account-new-reserved" || item.id === "account-new-too-long") {
      await content.locator('input[type="text"]').first().fill("Release Bot");
      await content.locator("#new-username").fill(item.id === "account-new-reserved" ? "admin" : "a".repeat(65));
      await expect(content.getByText(item.id === "account-new-reserved" ? "利用できません" : "長すぎます")).toBeVisible();
      await expect(content.getByRole("dialog").getByRole("button", { name: "作成" })).toBeDisabled();
    } else if (item.id === "account-new-taken") {
      await content.locator('input[type="text"]').first().fill("Release Bot");
      await content.locator("#new-username").fill("alice");
      await expect(content.getByText("利用できません")).toBeVisible();
      await expect(content.getByRole("dialog").getByRole("button", { name: "作成" })).toBeDisabled();
      await expect(content.locator("#new-username")).toHaveValue("alice");
    } else if (item.id === "account-new-confirm") {
      await content.locator('input[type="text"]').first().fill("release-bot");
      await content.locator("#new-username").fill("release-bot");
      await expect(content.getByText("利用できます")).toBeVisible();
      await content.getByRole("dialog").getByRole("button", { name: "作成" }).click();
      await expect(content.getByText("後から変更できません。")).toBeVisible();
      await expect(content.locator("#username-confirm-id")).toContainText("@release-bot");
    } else if (item.id === "account-detail-unset") {
      await expect(content.locator("h1")).toContainText("Bob Builder");
      await expect(content.getByText("ユーザー名が未設定です")).toBeVisible();
    } else if (item.id === "username-help") {
      await expect(content.getByRole("heading", { name: "ユーザー名について" })).toBeVisible();
      await expect(content.getByText("ユーザー名は後から変更できません。")).toBeVisible();
    } else if (item.id === "account-detail-set-invalid") {
      await expect(content.locator("h1")).toContainText("Bob Builder");
      await content.getByRole("button", { name: "設定する" }).click();
      await content.locator("#set-username").fill("Bob");
      await expect(content.getByText("先頭は a〜z か 0〜9")).toBeVisible();
      await expect(content.getByRole("dialog").getByRole("button", { name: "設定", exact: true })).toBeDisabled();
    } else if (item.id === "account-detail-set-taken") {
      await expect(content.locator("h1")).toContainText("Bob Builder");
      await content.getByRole("button", { name: "設定する" }).click();
      await content.locator("#set-username").fill("alice");
      await expect(content.getByText("利用できません")).toBeVisible();
      await expect(content.getByRole("dialog").getByRole("button", { name: "設定", exact: true })).toBeDisabled();
      await expect(content.locator("#set-username")).toHaveValue("alice");
    } else if (item.id === "account-detail-already-set") {
      await expect(content.locator("h1")).toContainText("Bob Builder");
      await content.getByRole("button", { name: "設定する" }).click();
      await content.locator("#set-username").fill("bob");
      await expect(content.getByText("利用できます")).toBeVisible();
      await content.getByRole("dialog").getByRole("button", { name: "設定", exact: true }).click();
      await expect(content.getByText("後から変更できません。")).toBeVisible();
      // Another session sets the username while this confirmation is open.
      await page.evaluate(async () => {
        await fetch("/graphql", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: 'mutation { setProfileUsername(profileId: "prof_02", username: "bob-elsewhere") { nanoid } }' }),
        });
      });
      await content.getByRole("dialog").getByRole("button", { name: "設定", exact: true }).click();
      await expect(content.getByText("ユーザー名はすでに設定されています")).toBeVisible();
      await expect(content.getByText("@bob-elsewhere").first()).toBeVisible();
    } else if (item.id === "account-detail-set-modal" || item.id === "account-detail-set-confirm") {
      await expect(content.locator("h1")).toContainText("Bob Builder");
      await content.getByRole("button", { name: "設定する" }).click();
      await content.locator("#set-username").fill("bob");
      await expect(content.getByText("利用できます")).toBeVisible();
      if (item.id === "account-detail-set-confirm") {
        await content.getByRole("dialog").getByRole("button", { name: "設定", exact: true }).click();
        await expect(content.getByText("後から変更できません。")).toBeVisible();
        await expect(content.locator("#username-confirm-id")).toContainText("@bob");
      }
    } else if (item.id.startsWith("account-detail")) {
      await expect(content.locator("h1")).toContainText("Alice Wonderland");
      await expect(page.getByText("@alice").first()).toBeVisible();
      await expect(page.getByText("https://alice.example.com", { exact: true })).toBeVisible();
      if (item.id === "account-detail-edit") {
        await content.getByRole("button").first().click();
        await expect(content.locator('input[type="text"]')).toHaveCount(3);
        await expect(page.locator("textarea")).toHaveValue("Exploring the rabbit hole of federated social networks.");
      }
    } else if (item.id === "settings") {
      await expect(content).toContainText(MOCK_IDENTIFIER);
      await expect(content.locator("button[data-color-option]")).toHaveCount(2);
      await expect(content.locator("button[data-shape-option]")).toHaveCount(2);
    } else if (item.id.startsWith("admin-")) {
      expectedPath = await prepareAdminScreen(page, item);
    }
  }
  return expectedPath;
}

const ADMIN_GATE_STATUS: Record<string, string> = {
  "admin-registration-not-opened": "NOT_OPENED",
  "admin-registration-open": "OPEN",
  "admin-registration-open-degraded": "OPEN",
  "admin-registration-suspended": "TEMPORARILY_SUSPENDED",
  "admin-registration-auto-stopped": "AUTO_STOPPED",
  "admin-registration-auto-stopped-recovered": "AUTO_STOPPED",
  "admin-registration-admin-stopped": "ADMIN_STOPPED",
  "admin-registration-override": "OVERRIDE",
  "admin-registration-override-ready": "OVERRIDE",
  "admin-registration-enforcement-lost": "AUTO_STOPPED",
  "admin-override-confirm": "NOT_OPENED",
  "admin-revoke-confirm": "OVERRIDE",
  "admin-notifications": "OPEN",
  "admin-notifications-more": "OPEN",
};

/** Cases whose scenario keeps the override value, so the warning strip must be shown on every admin page. */
const ADMIN_OVERRIDE_CASES = new Set([
  "admin-registration-override",
  "admin-registration-override-ready",
  "admin-registration-enforcement-lost",
  "admin-revoke-confirm",
  "admin-webhook-failed",
]);

/** Webhook cases with failed deliveries (the "配送失敗" list and the tab mark). */
const ADMIN_WEBHOOK_FAILED_CASES = new Set(["admin-webhook-failed", "admin-webhook-multiple", "admin-webhook-many-failures"]);

/**
 * Registration gate admin screens. main (the baseline) has no admin routes and renders its 404 page for these
 * paths, so the admin assertions only run when the branch build serves the admin page. The checks also prove
 * the SSR + hydration path left one intact DOM and that the override warning survives reload and navigation
 * while it never appears on general pages.
 */
async function prepareAdminScreen(page: Page, item: ScreenCase): Promise<string> {
  const content = page.locator("#content");
  const adminPage = content.getByTestId("admin-page");
  const notFound = content.locator("h1 + p");
  await expect(adminPage.or(notFound).first()).toBeVisible();
  if (item.id === "admin-not-found-for-member" || (await adminPage.count()) === 0) {
    await expect(notFound).toBeVisible();
    await expect(page.locator("#notification-bell")).toHaveCount(0);
    await expect(page.locator('main#app > nav a[href^="/admin/"]')).toHaveCount(0);
    return item.path;
  }
  const strip = page.getByTestId("override-strip");
  const expectStrip = async () => {
    await expect(strip).toHaveCount(ADMIN_OVERRIDE_CASES.has(item.id) ? 1 : 0);
  };
  const registrationReady = async () => {
    const gate = content.getByTestId("registration-gate");
    await expect(gate).toHaveCount(1);
    await expect(gate).toHaveAttribute("data-status", ADMIN_GATE_STATUS[item.id] ?? "");
    await expect(content.locator('[data-testid^="protection-"]')).toHaveCount(2);
  };
  const webhookReady = async () => {
    await expect(content.getByTestId("webhook-destinations")).toHaveCount(1);
    await expect(content.getByTestId("webhook-failed")).toHaveCount(ADMIN_WEBHOOK_FAILED_CASES.has(item.id) ? 1 : 0);
    // Failure rows name the destination host only when there are two or more destinations.
    await expect(content.getByTestId("webhook-failed-host")).toHaveCount(item.id === "admin-webhook-multiple" ? 1 : 0);
    if (item.id === "admin-webhook-multiple") await expect(content.getByTestId("webhook-failed-host")).toHaveText("ops.example.org");
    // The full URL and the secret never reach the page; destinations show the masked form only.
    expect(await page.content()).not.toMatch(/https:\/\/hooks\.|0123456789abcdef/);
  };
  await expect(page.locator("main#app")).toHaveCount(1);
  await expect(page.locator("main#app > nav")).toHaveCount(1);
  await expect(content.locator("h1")).toHaveCount(1);
  await expect(page.locator("#notification-bell")).toHaveCount(1);
  if (item.path === "/admin/webhook") await webhookReady();
  else await registrationReady();
  await expectStrip();

  if (item.id === "admin-registration-override") {
    // The warning is part of the SSR HTML itself (not only added after the client fetch).
    const ssr = await page.context().request.get(page.url());
    expect(await ssr.text()).toContain('data-testid="override-strip"');
    // Reload: SSR + resume again, the warning comes back with the state.
    await page.reload({ waitUntil: "networkidle" });
    await registrationReady();
    await expectStrip();
    // General pages never show the warning; returning to the admin page shows it again.
    await page.locator('main#app > nav a[href="/"]').click();
    await expect(page.locator('main a[href="/accounts/acc_01"]')).toBeVisible();
    await expect(strip).toHaveCount(0);
    await page.locator('main#app > nav a[href="/admin/registration"]').click();
    await registrationReady();
    await expectStrip();
  } else if (item.id === "admin-webhook-failed") {
    // Navigating between admin tabs keeps the warning.
    await content.locator('a[href="/admin/registration"]').click();
    await expect(content.getByTestId("registration-gate")).toHaveCount(1);
    await expectStrip();
    await content.locator('a[href="/admin/webhook"]').click();
    await webhookReady();
    await expectStrip();
  } else if (item.id === "admin-webhook-many-failures") {
    // Failed deliveries beyond the first page (50) are reachable; the load-more control disappears on the last page.
    const failed = content.getByTestId("webhook-failed");
    await expect(failed.getByRole("button", { name: "再試行" })).toHaveCount(50);
    await failed.getByTestId("webhook-failures-more").click();
    await expect(failed.getByRole("button", { name: "再試行" })).toHaveCount(60);
    await expect(failed.getByTestId("webhook-failures-more")).toHaveCount(0);
  } else if (item.id === "admin-webhook-add") {
    await content.getByTestId("webhook-add").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#webhook-url")).toHaveValue("");
    await expect(page.locator("#webhook-secret")).toHaveValue("");
    await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(4);
    await expect(page.getByTestId("webhook-save")).toBeDisabled();
    await expect(page.getByTestId("webhook-delete")).toHaveCount(0);
  } else if (item.id === "admin-webhook-edit") {
    // The edit modal opens with empty URL / secret fields (neither is ever returned) and offers 削除.
    await content.getByTestId("webhook-edit-1").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#webhook-url")).toHaveValue("");
    await expect(page.locator("#webhook-secret")).toHaveValue("");
    await expect(page.getByTestId("webhook-save")).toBeDisabled();
    await expect(page.getByTestId("webhook-delete")).toBeEnabled();
  } else if (item.id === "admin-override-confirm") {
    await content.getByTestId("gate-override").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#override-ack")).not.toBeChecked();
    await expect(page.getByTestId("override-confirm")).toBeDisabled();
  } else if (item.id === "admin-revoke-confirm") {
    await strip.getByTestId("override-strip-revoke").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByTestId("revoke-confirm")).toBeEnabled();
  } else if (item.id === "admin-notifications") {
    await page.locator("#notification-bell").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("button")).toHaveCount(7);
  } else if (item.id === "admin-notifications-more") {
    // Notifications beyond the first page (50) are reachable; the load-more control disappears on the last page.
    await page.locator("#notification-bell").click();
    const panel = page.getByTestId("notification-panel");
    await expect(panel.locator("button")).toHaveCount(52);
    await panel.getByTestId("notifications-more").click();
    await expect(panel.locator("button")).toHaveCount(63);
    await expect(panel.getByTestId("notifications-more")).toHaveCount(0);
  }
  return item.path;
}

/**
 * ShuttlePub SNS shell (ui-spec v6). Waits for hydration and the mock fixtures that
 * arrive through the real BFF, then opens the overlay a case photographs. Controls
 * are found by role/name or test id so the same steps work at both widths (the
 * desktop and mobile chrome are separate elements; only one is visible).
 */
async function prepareShuttlePubShell(page: Page, item: ScreenCase) {
  const shell = page.getByTestId("app-shell");
  const content = page.locator("#content");
  await expect(shell).toHaveAttribute("data-hydration", "hydrated");
  await expect(shell).toHaveAttribute("data-api-mode", "mock");
  await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "loaded");
  await expect(page.getByRole("button", { name: /投稿用 Profile を切り替え（現在: Fixture Profile）/ }).filter({ visible: true })).toHaveCount(1);
  if (item.path === "/") {
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-state", "loaded");
    await expect(content.locator("article")).toHaveCount(5);
  }
  // Quick reaction UI (D03) present on this revision: wait for its data, which arrives
  // after the posts (reaction chips) or the Profile (favourites).
  const reactionUi = await page.locator(".sp-reaction-layer").count() > 0;
  // D08 cases open hidden posts (no reactions to wait for) and wait for their own state below.
  if (reactionUi && !item.id.startsWith("domain-") && (item.path === "/" || item.path.startsWith("/posts/"))) {
    await expect(content.getByTestId("reactions").first()).toBeVisible();
  }
  if (reactionUi && item.path === "/settings") {
    await expect(page.getByTestId("favorites")).toHaveAttribute("data-state", "loaded");
  }
  if (item.id === "post-detail") {
    await expect(page.getByTestId("post-detail")).toHaveAttribute("data-state", "loaded");
    await expect(content.locator("article")).toHaveCount(3);
    await expect(page.getByRole("tab", { name: /返信/ })).toHaveAttribute("aria-selected", "true");
  } else if (item.id === "compose" || item.id === "compose-visibility") {
    await page.getByRole("button", { name: "投稿する" }).filter({ visible: true }).click();
    const dialog = page.getByRole("dialog", { name: "投稿" });
    await expect(dialog).toBeVisible();
    if (item.id === "compose") {
      await dialog.getByRole("textbox", { name: "投稿内容" }).fill("ShuttlePub の投稿フォームを確認しています");
      await expect(page.getByTestId("compose-submit")).toBeEnabled();
    } else {
      await expect(page.getByTestId("compose-submit")).toBeDisabled();
      await page.getByTestId("compose-visibility").click();
      await expect(dialog.getByRole("menu", { name: "公開範囲" }).getByRole("menuitemradio")).toHaveCount(4);
    }
  } else if (item.id === "profile-menu") {
    await page.getByRole("button", { name: /投稿用 Profile を切り替え/ }).filter({ visible: true }).click();
    await expect(page.getByTestId("profile-menu").getByRole("menuitemradio")).toHaveCount(3);
  } else if (item.id === "settings") {
    await expect(content).toContainText("Fixture Profile");
  } else if (item.id.startsWith("reaction-")) {
    await prepareQuickReaction(page, item);
  } else if (item.id.startsWith("domain-")) {
    await prepareDomainContent(page, item);
  } else if (item.id.startsWith("mute-block-")) {
    // Rows come from the BFF's stateful mock through GraphQL after hydration.
    const panel = item.id === "mute-block-accounts" ? "account-panel" : "domain-panel";
    await expect(page.getByTestId(panel).locator("section")).toHaveAttribute("data-state", "loaded");
    if (item.id === "mute-block-accounts") {
      await expect(page.locator('li[data-actor="https://spam.example/users/spam_bot"]')).toBeVisible();
    } else {
      await expect(page.locator('li[data-domain="bot-farm.example"]')).toBeVisible();
    }
    if (item.id === "mute-block-block-dialog") {
      // "+" -> pasted URL -> ブロック: normalized domain, detached follows listed.
      await page.locator("#mb-add-button").click();
      await page.locator("#mb-add-input").fill("https://Example.social/@alice");
      await page.getByTestId("add-dialog").getByRole("button", { name: "ブロック", exact: true }).click();
      await expect(page.getByTestId("block-impact")).toContainText("フォロー中 3 人・フォロワー 5 人");
      await page.getByTestId("block-impact").locator("summary").click();
      await expect(page.getByTestId("block-dialog")).toContainText("example.social をブロックしますか？");
    }
  }
}

/**
 * D08 second stage (host personal-domain-controls-ui ui-spec v5): the post menu, a muted
 * domain's post opened by URL (hidden), a blocked one revealed (locked operations) and
 * its 4-1 sheet, a revealed quote whose target stays hidden (S8), folded replies opened,
 * and a blocked person's page hidden / revealed. Reveals are stateless; nothing is written.
 */
async function prepareDomainContent(page: Page, item: ScreenCase) {
  const content = page.locator("#content");
  const reveal = async () => {
    await expect(page.getByTestId("hidden-post")).toBeVisible();
    await page.getByRole("button", { name: /この投稿だけ表示|投稿を表示/ }).click();
  };
  if (item.id === "domain-post-menu") {
    await expect(content.getByTestId("reactions").first()).toBeVisible();
    await page.locator("#sp-more-post-mika-picker").click();
    await expect(page.getByTestId("post-menu").getByRole("menuitem")).toHaveCount(4);
  } else if (item.id === "domain-post-hidden") {
    await expect(page.getByTestId("hidden-post")).toHaveAttribute("data-mode", "mute");
  } else if (item.id === "domain-post-revealed-block" || item.id === "domain-blocked-sheet") {
    await reveal();
    await expect(page.locator('[data-locked="reply"]')).toBeVisible();
    if (item.id === "domain-blocked-sheet") {
      await page.locator('[data-locked="reply"]').click();
      await expect(page.getByTestId("blocked-sheet").getByRole("button", { name: "閉じる" })).toBeFocused();
    } else {
      await expect(page.getByRole("button", { name: "隠す" })).toBeFocused();
    }
  } else if (item.id === "domain-quote-revealed") {
    await reveal();
    await expect(content.getByTestId("quote")).toHaveAttribute("data-state", "hidden");
  } else if (item.id === "domain-replies") {
    await expect(content.getByTestId("reactions").first()).toBeVisible();
    await page.getByTestId("hidden-replies").click();
    await page.getByTestId("hidden-reply").first().getByRole("button", { name: "表示" }).click();
    await expect(page.getByTestId("revealed-reply")).toBeVisible();
  } else if (item.id === "domain-user-hidden") {
    await expect(page.getByTestId("user-page")).toHaveAttribute("data-state", "loaded");
    await expect(page.getByTestId("hidden-post")).toBeVisible();
  } else if (item.id === "domain-user-revealed") {
    await expect(page.getByTestId("user-page")).toHaveAttribute("data-state", "loaded");
    await reveal();
    await expect(page.getByTestId("revealed-posts")).toBeVisible();
    await expect(page.getByTestId("restricted-post")).toBeVisible();
  }
}

/**
 * Quick reaction states (host intents/shuttlepub/features/quick-reaction-ui/ui-spec.md
 * v6). The mock is reset before every ShuttlePub case (POST /__mock/reset) and these
 * steps leave no state behind: the undo case reacts on a post first and removes only
 * that reaction, so a removal sent when the page goes away restores the fixtures.
 */
async function prepareQuickReaction(page: Page, item: ScreenCase) {
  const picker = page.getByTestId("picker");
  if (item.id === "reaction-picker" || item.id === "reaction-picker-no-favorites") {
    if (item.id === "reaction-picker-no-favorites") {
      // P3: a Profile that never saved favourites has no favourites row.
      await page.getByRole("button", { name: /投稿用 Profile を切り替え/ }).filter({ visible: true }).click();
      await page.getByTestId("profile-menu").getByRole("menuitemradio", { name: /Fixture Dev/ }).click();
      await expect(page.getByRole("button", { name: /投稿用 Profile を切り替え（現在: Fixture Dev）/ }).filter({ visible: true })).toHaveCount(1);
      await expect(page.getByTestId("reactions").first()).toBeVisible();
    }
    await page.locator("#react-post-mika-picker").click();
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("picker-grid").getByRole("button")).toHaveCount(16);
    await expect(picker.getByTestId("picker-favorites")).toHaveCount(item.id === "reaction-picker" ? 1 : 0);
    if (item.id === "reaction-picker") {
      await expect(picker.getByRole("button", { name: ":old_blob:（利用不可）" })).toHaveAttribute("aria-disabled", "true");
    }
  } else if (item.id === "reaction-undo") {
    // C2: remove my reaction; the undo toast stays while hovered (実装上の注意 3).
    await page.locator("#react-post-mika-picker").click();
    await picker.getByTestId("picker-favorites").getByRole("button", { name: "いいね" }).click();
    const mine = page.locator("#react-mine-post-mika-picker");
    await expect(mine).toBeFocused();
    await expect(mine).not.toHaveAttribute("aria-busy", "true");
    await mine.click();
    const toast = page.getByTestId("reaction-toast");
    await expect(toast).toContainText("取り消しました");
    await toast.hover();
    await expect(page.locator("#react-post-mika-picker")).toBeFocused();
  } else if (item.id === "reaction-detail") {
    // D1: the reactions tab opens on 「すべて」 with every reactor.
    await expect(page.getByTestId("post-detail")).toHaveAttribute("data-state", "loaded");
    await page.getByRole("tab", { name: /リアクション/ }).click();
    await expect(page.getByRole("button", { name: /^すべて/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("reactor-list").locator("li")).toHaveCount(19);
  } else if (item.id === "reaction-settings-menu") {
    // S4: the unavailable favourite's menu starts with 入れ替え.
    await page.getByRole("button", { name: ":old_blob:（利用不可）" }).click();
    const menu = page.getByTestId("favorite-menu");
    await expect(menu.getByRole("menuitem").first()).toHaveText("入れ替え");
  }
}

/**
 * ShuttlePub login UI (FA) against the real-mode BFF: no session, or a stale cookie the
 * BFF clears. The header offers the login entry, posting stays disabled and the screen
 * explains the state. Login links are asserted to start the BFF's OIDC login.
 */
async function prepareShuttlePubSignedOut(page: Page, item: ScreenCase) {
  const shell = page.getByTestId("app-shell");
  const content = page.locator("#content");
  await expect(shell).toHaveAttribute("data-hydration", "hydrated");
  await expect(shell).toHaveAttribute("data-api-mode", "real");
  await expect(page.getByTestId("api-status")).toHaveAttribute("data-state", "loaded");
  await expect(page.getByTestId("login-link").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId("login-link").filter({ visible: true })).toHaveAttribute("href", "/auth/login");
  await expect(page.getByRole("button", { name: "投稿する" }).filter({ visible: true })).toBeDisabled();
  await expect(page.getByText("Fixture Profile")).toHaveCount(0);
  if (item.path.startsWith("/login")) {
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("login-start")).toHaveAttribute("href", "/auth/login");
    const reason = new URL(item.path, "http://visual.invalid").searchParams.get("error");
    if (reason) await expect(page.getByTestId("login-error")).toHaveAttribute("data-state", reason);
    else await expect(page.getByTestId("login-error")).toHaveCount(0);
    await expect(page.getByTestId("auth-notice")).toHaveCount(0);
  } else {
    const notice = page.getByTestId("auth-notice");
    await expect(notice).toHaveAttribute("data-state", viewerOf(item) === "session-expired" ? "expired" : "signed-out");
    await expect(notice.getByRole("link")).toHaveAttribute("href", "/auth/login");
    // No timeline endpoint in the pinned OpenAPI: shown as such, never as mock posts.
    await expect(page.getByTestId("timeline")).toHaveAttribute("data-error", "not_implemented");
    await expect(content.locator("article")).toHaveCount(0);
  }
}

async function captureScreen(browser: Browser, server: AppServer, item: ScreenCase, output: string) {
  const viewer = viewerOf(item);
  // A real-mode viewer without a usable session: the BFF answers these GraphQL errors
  // by design (and the client displays them). Any other code still fails the capture.
  const expectedGraphqlCodes = viewer ? new Set(["UNAUTHENTICATED", "NOT_IMPLEMENTED"]) : new Set<string>(EXPECTED_GRAPHQL_CODES[item.id] ?? []);
  const context = await browser.newContext({
    baseURL: server.url, viewport: { width: item.viewport.width, height: item.viewport.height },
    deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC", colorScheme: "dark",
    reducedMotion: "reduce", serviceWorkers: "block",
  });
  try {
    // The quick reaction mock is stateful: every case starts from its fixtures. A
    // revision without the route answers its SSR shell, which is harmless.
    if (item.app === "ShuttlePub" && viewer === undefined) await fetch(`${server.url}/__mock/reset`, { method: "POST" });
    const errors: string[] = [];
    const responseChecks: Promise<void>[] = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (new URL(request.url()).origin === server.url) return route.continue();
      const svg = request.resourceType() === "image" ? localImage(request.url()) : undefined;
      if (svg) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg });
      errors.push(`Unexpected external request: ${request.url()}`);
      return route.abort("blockedbyclient");
    });
    if (item.authenticated) {
      // Use Chromium's HTTP/cookie implementation. Bun 1.3.13 supplies a
      // relative response URL to Playwright's Node APIRequestContext, which
      // breaks its Set-Cookie parser even when the request URL is absolute.
      const loginPage = await context.newPage();
      try {
        await loginPage.goto("/login", { waitUntil: "networkidle" });
        const login = await loginPage.evaluate(async (credentials) => {
          const response = await fetch("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
            signal: AbortSignal.timeout(15_000),
          });
          return { status: response.status, json: await response.json() };
        }, { identifier: MOCK_IDENTIFIER, password: MOCK_PASSWORD });
        expect(login.status, `${item.filename}: mock login`).toBe(200);
        expect(login.json).toMatchObject({ authenticated: true, username: MOCK_IDENTIFIER });
      } finally {
        await loginPage.close();
      }
    }
    if (viewer === "session-expired") {
      // A session cookie the BFF can no longer open (as after expiry or a key change).
      await context.addCookies([{ name: SHUTTLEPUB_LOOPBACK_SESSION_COOKIE, value: "visual-stale-session", url: server.url }]);
    }
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.clock.setFixedTime(new Date(FIXED_TIME));
    await page.addInitScript(() => {
      localStorage.setItem("ratcap-color", "catppuccin-mocha");
      localStorage.setItem("ratcap-shape", "rounded");
    });
    const expectedAnonymousSession = (url: string, status: number) =>
      !item.authenticated && url === `${server.url}/auth/session` && status === 401;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (expectedAnonymousSession(message.location().url, 401) && /Failed to load resource:.*401/.test(message.text())) return;
      errors.push(`Console: ${message.text()}`);
    });
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => {
      if (response.status() >= 400 && !expectedAnonymousSession(response.url(), response.status())) {
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
      }
      if (response.url() === `${server.url}/graphql`) {
        responseChecks.push(response.json().then((body: { errors?: { extensions?: { code?: unknown } }[] }) => {
          const unexpected = body.errors?.filter((error) => !expectedGraphqlCodes.has(String(error.extensions?.code)));
          if (unexpected?.length) errors.push(`GraphQL: ${JSON.stringify(unexpected)}`);
        }).catch((error: unknown) => { errors.push(`Invalid GraphQL response: ${String(error)}`); }));
      }
    });
    // A session response proves the production client has resumed the SSR page.
    // ShuttlePub has no sessions: its client sends its first /graphql request on resume.
    const resumeProof = item.app === "ShuttlePub" ? `${server.url}/graphql` : `${server.url}/auth/session`;
    const sessionResponse = page.waitForResponse(resumeProof);
    if (item.app === "Emumet") {
      // The built-in Emumet mock is shared by all cases: select this case's registration gate state (or reset it)
      // before SSR. main has no such endpoint and answers with its SSR page, which leaves its mock untouched.
      const scenario = "scenario" in item ? item.scenario : "default";
      const selected = await context.request.post(`${server.url}/__mock/registration-gate/scenario`, { data: { name: scenario } });
      expect(selected.status(), `${item.filename}: mock scenario ${scenario}`).toBeLessThan(300);
    }
    const documentResponse = await page.goto(item.path, { waitUntil: "networkidle" });
    expect(documentResponse?.status(), `${item.filename}: SSR`).toBe(200);
    expect((await sessionResponse).status()).toBe(item.app === "ShuttlePub" || item.authenticated ? 200 : 401);
    await expect(page.locator("main#app")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-color", "catppuccin-mocha");
    await expect(page.locator("html")).toHaveAttribute("data-shape", "rounded");
    const expectedPath = await prepareScreen(page, item);
    await expect(page).toHaveURL(new URL(expectedPath, server.url).href);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (image) => image.decode()));
    });
    await expect(page.locator('[role="alert"]:visible, [data-testid="file-upload-error"]:visible')).toHaveCount(0);
    await expect(page.getByText(/^(Loading|Logging in|Failed to load|読み込み)/)).toHaveCount(0);
    await Promise.all(responseChecks);
    expect(errors, `${item.filename}: unexpected browser errors`).toEqual([]);
    await page.screenshot({ path: resolve(output, item.filename), fullPage: true, animations: "disabled", caret: "hide" });
    await Promise.all(responseChecks);
    expect(errors, `${item.filename}: errors during screenshot`).toEqual([]);
    console.info(`Captured ${item.filename}`);
  } finally {
    await context.close();
  }
}

export async function captureScreens(frontendRoot: string, output: string, side: CaptureSide = "branch") {
  if (!isAbsolute(frontendRoot) || !isAbsolute(output)) throw new Error("FRONTEND_ROOT and CAPTURE_DIR must be absolute paths");
  await mkdir(output, { recursive: true });
  const stub = startBooskiffStub();
  let shuttlePubStub: ReturnType<typeof startShuttlePubStub> | undefined;
  const servers: AppServer[] = [];
  let browser: Browser | undefined;
  let failed = false;
  try {
    // Register each child immediately so partial startup failure always cleans up.
    for (const app of ["Booskiff", "Emumet", "ShuttlePub"] as const) {
      servers.push(await startApp(frontendRoot, app, stub.url));
    }
    await Promise.all(servers.map((server) => server.waitUntilReady()));
    const capturedApps = new Set<ScreenApp>(servers.map((server) => server.app));
    const shuttlePub = servers.find((server) => server.app === "ShuttlePub")!;
    const emumet = servers.find((server) => server.app === "Emumet")!;
    const shuttlePubHtml = await Promise.all(SHUTTLEPUB_PROBE_PATHS.map(async (path) => (await fetch(`${shuttlePub.url}${path}`)).text()));
    const features = new Set([
      ...featuresInShuttlePubHtml(shuttlePubHtml.join("\n")),
      ...featuresInEmumetHtml(await (await fetch(`${emumet.url}/accounts/new`)).text()),
      // Every Emumet case selects its own scenario before loading, so the probe leaves nothing behind.
      ...featuresFromEmumetScenarioProbe(
        (
          await fetch(`${emumet.url}/__mock/registration-gate/scenario`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: EMUMET_WEBHOOK_PROBE_SCENARIO }),
          })
        ).status,
      ),
    ]);
    const { capture: cases, skipped } = selectCases(SCREEN_CASES.filter((item) => capturedApps.has(item.app)), features, side);
    for (const item of skipped) {
      console.info(`Skipped ${item.filename}: this baseline does not have "${"requires" in item ? item.requires : ""}" yet (reported as New)`);
    }
    // Real-mode ShuttlePub (cases.ts ScreenViewer) runs as a second server, only when needed.
    let shuttlePubReal: AppServer | undefined;
    if (cases.some((item) => viewerOf(item))) {
      shuttlePubStub = startShuttlePubStub();
      shuttlePubReal = await startApp(frontendRoot, "ShuttlePub", shuttlePubStub.url, { env: shuttlePubStub.env });
      servers.push(shuttlePubReal);
      await shuttlePubReal.waitUntilReady();
    }
    browser = await chromium.launch({
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    });
    for (const item of cases) {
      const server = viewerOf(item) ? shuttlePubReal! : servers.find((entry) => entry.app === item.app)!;
      stub.setState(item.data);
      await captureScreen(browser, server, item, output);
      expect(stub.unexpectedRequests, `${item.filename}: unexpected Core API requests`).toEqual([]);
      expect(shuttlePubStub?.unexpectedRequests ?? [], `${item.filename}: unexpected ShuttlePub backend/IdP requests`).toEqual([]);
      for (const entry of servers) {
        expect(await entry.networkViolations(), `${entry.app}: unexpected server requests`).toEqual([]);
      }
      if (MUTATES_SERVER.has(item.id)) {
        // The mock Emumet keeps what this case wrote; start a fresh one so every later case sees the seed data.
        const index = servers.indexOf(server);
        await server.stop();
        const fresh = await startApp(frontendRoot, item.app, stub.url);
        servers[index] = fresh;
        await fresh.waitUntilReady();
      }
    }
    console.info(`Captured ${cases.length} app screenshots in ${output}`);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), ...servers.map((server) => server.stop())]);
    stub.stop();
    shuttlePubStub?.stop();
    if (failed) {
      for (const server of servers) console.error(`${server.app} server log:\n${await server.logs()}`);
    }
    const cleanupErrors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (cleanupErrors.length) {
      if (!failed) throw new AggregateError(cleanupErrors, "Visual capture cleanup failed");
      console.error("Visual capture cleanup errors:", cleanupErrors);
    }
  }
}

if (import.meta.main) {
  await captureScreens(
    resolve(process.env.FRONTEND_ROOT ?? resolve(import.meta.dir, "../../../..")),
    resolve(process.env.CAPTURE_DIR ?? ".visual/actual"),
    captureSide(process.env.CAPTURE_SIDE),
  );
}
