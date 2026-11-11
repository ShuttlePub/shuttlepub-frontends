export const FIXED_TIME = "2026-01-15T12:00:00.000Z";
export const MOCK_IDENTIFIER = "visual-review@example.com";
export const MOCK_PASSWORD = "password";

export type ScreenApp = "Booskiff" | "Emumet" | "ShuttlePub";

export type DataState = "populated" | "empty";

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
  // ShuttlePub F0 foundation: the plain placeholder only. This registers the capture
  // route and proves SSR + hydration at both widths; it does not fix any screen layout.
  { app: "ShuttlePub", id: "home", path: "/", authenticated: false, data: "populated" },
  { app: "ShuttlePub", id: "not-found", path: "/visual-route-not-found", authenticated: false, data: "populated" },
  // D08 mute/block settings (personal-domain-controls-web-ui, UI mock v5): both sub-pages
  // with the stateful mock's seed, and the block confirmation with detached follows.
  // marker: these routes are new, so a baseline revision without them is skipped (see capture.ts).
  { app: "ShuttlePub", id: "mute-block-domains", path: "/settings/mute-block/domains", authenticated: false, data: "populated", marker: "mute-block" },
  { app: "ShuttlePub", id: "mute-block-accounts", path: "/settings/mute-block/accounts", authenticated: false, data: "populated", marker: "mute-block" },
  { app: "ShuttlePub", id: "mute-block-block-dialog", path: "/settings/mute-block/domains", authenticated: false, data: "populated", marker: "mute-block" },
] as const satisfies readonly {
  app: ScreenApp; id: string; path: string; authenticated: boolean; data: DataState;
  /**
   * data-testid that only exists once the route exists. A revision whose SSR shows the
   * shared NotFound page instead (the baseline before the route was added) skips the case,
   * so the comparison reports a new screen instead of failing the baseline capture.
   */
  marker?: string;
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
