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
 *  - emumet-username-ui: the Emumet username screens (create modal, one-time set dialog, help), detected by
 *    the SSR marker data-username-dialog on /accounts/new.
 */
export type ScreenFeature = "sns-shell" | "emumet-username-ui";

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
  app: ScreenApp; id: string; path: string; authenticated: boolean; data: DataState; requires?: ScreenFeature;
}[];

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

/** Cases that write to the mock Emumet; the driver restarts that app afterwards so later cases see the seed data. */
export const MUTATES_SERVER: ReadonlySet<string> = new Set(["account-detail-already-set"]);

/** GraphQL error codes a case is meant to provoke (everything else fails the capture). */
export const EXPECTED_GRAPHQL_CODES: Readonly<Record<string, readonly string[]>> = {
  "account-new-taken": ["USERNAME_TAKEN"],
  "account-detail-set-taken": ["USERNAME_TAKEN"],
  "account-detail-already-set": ["USERNAME_ALREADY_SET"],
};

/** Serializable inventory shared by the current driver for both Git revisions. */
export const SCREEN_CASES = routes.flatMap((route) => viewports.map((viewport) => ({
  ...route,
  viewport,
  filename: `${route.app}-${route.id}-${viewport.name}.png`,
})));

export type ScreenCase = typeof SCREEN_CASES[number];
