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

/** Serializable inventory shared by the current driver for both Git revisions. */
export const SCREEN_CASES = routes.flatMap((route) => viewports.map((viewport) => ({
  ...route,
  viewport,
  filename: `${route.app}-${route.id}-${viewport.name}.png`,
})));

export type ScreenCase = typeof SCREEN_CASES[number];
