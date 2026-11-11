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
 *  - quick-reaction: the D03 quick reaction UI (picker, chips, favourites), detected by
 *    its SSR layer class="sp-reaction-layer".
 *  - emumet-username-ui: the Emumet username screens (create modal, one-time set dialog, help), detected by
 *    the SSR marker data-username-dialog on /accounts/new.
 *  - sns-login: the ShuttlePub login screen (FA), detected by the /login SSR marker
 *    data-testid="login-page".
 */
export type ScreenFeature = "sns-shell" | "quick-reaction" | "emumet-username-ui" | "sns-login" | "emumet-webhook-endpoints";

/**
 * ShuttlePub only. A case with a viewer is captured against the real-mode BFF (stub
 * ShuttlePub backend, no IdP is ever contacted) instead of the mock fixtures, as a
 * browser that has no session (signed-out) or sends a session cookie the BFF can no
 * longer use (session-expired). Signed-in real states need a real IdP: see the BFF
 * tests and the real-stack E2E.
 */
export type ScreenViewer = "signed-out" | "session-expired";

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
  // Username screens (profile-identity-web-adaptation): these states do not exist on a revision without
  // the username UI, so the baseline skips them (`requires`) and compare reports them as New.
  { app: "Emumet", id: "account-new-invalid", path: "/accounts/new", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-new-reserved", path: "/accounts/new", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-new-too-long", path: "/accounts/new", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-new-taken", path: "/accounts/new", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-new-confirm", path: "/accounts/new", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-unset", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-set-modal", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-set-invalid", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-set-taken", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-set-confirm", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "account-detail-already-set", path: "/accounts/acc_02", authenticated: true, data: "populated", requires: "emumet-username-ui" },
  { app: "Emumet", id: "username-help", path: "/help/username", authenticated: true, data: "populated", requires: "emumet-username-ui" },
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
  // E15x Webhook destinations (register / edit / delete, per-destination state, paged failures). A baseline whose
  // mock does not know these scenarios skips them (reported as New).
  ...([
    ["admin-webhook-multiple", "webhook-multiple"],
    ["admin-webhook-environment", "webhook-environment"],
    ["admin-webhook-secret-undecryptable", "webhook-secret-undecryptable"],
    ["admin-webhook-many-failures", "webhook-many-failures"],
    ["admin-webhook-add", "webhook-unset"],
    ["admin-webhook-edit", "open"],
  ] as const).map(([id, scenario]) => ({ app: "Emumet", id, path: "/admin/webhook", authenticated: true, data: "populated", scenario, requires: "emumet-webhook-endpoints" }) as const),
  // ShuttlePub SNS shell (host intents/shuttlepub/features/quick-reaction-ui/ui-spec.md v6):
  // home timeline, post detail, compose modal, visibility menu, Profile switcher, settings.
  // home / not-found existed as F0 placeholders on main, so they compare as changed.
  { app: "ShuttlePub", id: "home", path: "/", authenticated: false, data: "populated" },
  { app: "ShuttlePub", id: "post-detail", path: "/posts/post-sora-zine", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "compose", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "compose-visibility", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "profile-menu", path: "/", authenticated: false, data: "populated", requires: "sns-shell" },
  { app: "ShuttlePub", id: "settings", path: "/settings", authenticated: false, data: "populated", requires: "sns-shell" },
  // Quick reaction (D03, ui-spec v6 C / P / D / S): picker with favourites, picker without
  // favourites (P3), the undo toast after removing my reaction (C2), the reactor list (D1 / D3)
  // and the favourite chip menu with an unavailable favourite (S3 / S4).
  { app: "ShuttlePub", id: "reaction-picker", path: "/", authenticated: false, data: "populated", requires: "quick-reaction" },
  { app: "ShuttlePub", id: "reaction-picker-no-favorites", path: "/", authenticated: false, data: "populated", requires: "quick-reaction" },
  { app: "ShuttlePub", id: "reaction-undo", path: "/", authenticated: false, data: "populated", requires: "quick-reaction" },
  { app: "ShuttlePub", id: "reaction-detail", path: "/posts/post-kei-release", authenticated: false, data: "populated", requires: "quick-reaction" },
  { app: "ShuttlePub", id: "reaction-settings-menu", path: "/settings", authenticated: false, data: "populated", requires: "quick-reaction" },
  { app: "ShuttlePub", id: "not-found", path: "/visual-route-not-found", authenticated: false, data: "populated" },
  // FA login UI (no ui-spec entry; built from the shell's parts): the login screen,
  // the callback's fixed failure reasons and the session notice above the home screen.
  { app: "ShuttlePub", id: "login", path: "/login", authenticated: false, data: "populated", requires: "sns-login", viewer: "signed-out" },
  { app: "ShuttlePub", id: "login-denied", path: "/login?error=denied", authenticated: false, data: "populated", requires: "sns-login", viewer: "signed-out" },
  { app: "ShuttlePub", id: "login-failed", path: "/login?error=failed", authenticated: false, data: "populated", requires: "sns-login", viewer: "signed-out" },
  { app: "ShuttlePub", id: "home-signed-out", path: "/", authenticated: false, data: "populated", requires: "sns-login", viewer: "signed-out" },
  { app: "ShuttlePub", id: "home-session-expired", path: "/", authenticated: false, data: "populated", requires: "sns-login", viewer: "session-expired" },
] as const satisfies readonly {
  app: ScreenApp; id: string; path: string; authenticated: boolean; data: DataState; scenario?: string; requires?: ScreenFeature; viewer?: ScreenViewer;
}[];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Cases that write to the mock Emumet; the driver restarts that app afterwards so later cases see the seed data. */
export const MUTATES_SERVER: ReadonlySet<string> = new Set(["account-detail-already-set"]);

/** GraphQL error codes a case is meant to provoke (everything else fails the capture). */
export const EXPECTED_GRAPHQL_CODES: Readonly<Record<string, readonly string[]>> = {
  "account-detail-already-set": ["USERNAME_ALREADY_SET"],
};

/** Serializable inventory shared by the current driver for both Git revisions. */
export const SCREEN_CASES = routes.flatMap((route) => viewports.map((viewport) => ({
  ...route,
  viewport,
  filename: `${route.app}-${route.id}-${viewport.name}.png`,
})));

export type ScreenCase = typeof SCREEN_CASES[number];
