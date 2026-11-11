export const FIXED_TIME = "2026-01-15T12:00:00.000Z";
export const MOCK_IDENTIFIER = "visual-review@example.com";
export const MOCK_PASSWORD = "password";

export type ScreenApp = "Booskiff" | "Emumet" | "ShuttlePub";

export type DataState = "populated" | "empty";

/**
 * A screen feature a capture case depends on. The driver runs against both the PR
 * and the main checkout; a case whose feature the checkout does not have yet is
 * skipped on the baseline side only (CAPTURE_SIDE=baseline) and reported by compare
 * as a New image. On the branch side a missing feature fails the capture.
 *  - sns-shell: the ShuttlePub SNS layout (ui-spec v6), detected by the SSR marker
 *    data-testid="app-shell".
 */
export type ScreenFeature = "sns-shell";

const routes = [
  { app: "Booskiff", id: "login", path: "/login", authenticated: false, data: "populated" },
  { app: "Booskiff", id: "drive-populated", path: "/drive", authenticated: true, data: "populated" },
  { app: "Booskiff", id: "drive-empty", path: "/drive", authenticated: true, data: "empty" },
  { app: "Booskiff", id: "drive-folder", path: "/drive", authenticated: true, data: "populated" },
  { app: "Booskiff", id: "file-detail", path: "/drive/files/file-design", authenticated: true, data: "populated" },
  { app: "Booskiff", id: "not-found", path: "/visual-route-not-found", authenticated: true, data: "populated" },
  { app: "Emumet", id: "login", path: "/login", authenticated: false, data: "populated" },
  { app: "Emumet", id: "accounts-populated", path: "/", authenticated: true, data: "populated" },
  { app: "Emumet", id: "account-new", path: "/accounts/new", authenticated: true, data: "populated" },
  { app: "Emumet", id: "account-new-filled", path: "/accounts/new", authenticated: true, data: "populated" },
  { app: "Emumet", id: "account-detail", path: "/accounts/acc_01", authenticated: true, data: "populated" },
  { app: "Emumet", id: "account-detail-edit", path: "/accounts/acc_01", authenticated: true, data: "populated" },
  { app: "Emumet", id: "settings", path: "/settings", authenticated: true, data: "populated" },
  { app: "Emumet", id: "not-found", path: "/visual-route-not-found", authenticated: true, data: "populated" },
  // Emumet D15 registration gate admin (ui-spec "mock A v5"). `scenario` selects the built-in mock state through the
  // mock-only /__mock/registration-gate/scenario endpoint before the page loads; every other Emumet case resets to
  // "default". main has no admin routes, so its capture of these paths is the 404 page.
  ...([
    ["admin-registration-not-opened", "not-opened"],
    ["admin-registration-open", "open"],
    ["admin-registration-open-degraded", "open-degraded"],
    ["admin-registration-suspended", "suspended"],
    ["admin-registration-auto-stopped", "auto-stopped"],
    ["admin-registration-auto-stopped-recovered", "auto-stopped-recovered"],
    ["admin-registration-admin-stopped", "admin-stopped"],
    ["admin-registration-override", "override"],
    ["admin-registration-override-ready", "override-ready"],
    ["admin-registration-enforcement-lost", "enforcement-lost"],
    ["admin-override-confirm", "not-opened"],
    ["admin-revoke-confirm", "override"],
    ["admin-notifications", "open-degraded"],
    ["admin-notifications-more", "notifications-many"],
    ["admin-not-found-for-member", "member"],
  ] as const).map(([id, scenario]) => ({ app: "Emumet", id, path: "/admin/registration", authenticated: true, data: "populated", scenario }) as const),
  ...([
    ["admin-webhook-healthy", "open"],
    ["admin-webhook-failed", "override"],
    ["admin-webhook-unset", "webhook-unset"],
    ["admin-webhook-misconfigured", "webhook-misconfigured"],
  ] as const).map(([id, scenario]) => ({ app: "Emumet", id, path: "/admin/webhook", authenticated: true, data: "populated", scenario }) as const),
  // ShuttlePub SNS shell (host intents/shuttlepub/features/quick-reaction-ui/ui-spec.md v6):
  // home timeline, post detail, compose modal, visibility menu, Profile switcher, settings.
  // home / not-found existed as F0 placeholders on main, so they compare as changed.
  { app: "ShuttlePub", id: "home", path: "/", authenticated: false, data: "populated" },
  { app: "ShuttlePub", id: "post-detail", path: "/posts/post-sora-zine", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "compose", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "compose-visibility", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "profile-menu", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "settings", path: "/settings", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "not-found", path: "/visual-route-not-found", authenticated: false, data: "populated" },
] as const satisfies readonly {
  app: ScreenApp; id: string; path: string; authenticated: boolean; data: DataState; scenario?: string; requires?: ScreenFeature;
}[];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Serializable inventory shared by the current driver for both Git revisions. */
export const SCREEN_CASES = routes.flatMap((route) => viewports.map((viewport) => ({
  ...route,
  viewport,
  filename: `${route.app}-${route.id}-${viewport.name}.png`,
})));

export type ScreenCase = typeof SCREEN_CASES[number];
