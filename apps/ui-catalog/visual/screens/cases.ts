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
  // ShuttlePub F0 foundation: the plain placeholder only. This registers the capture
  // route and proves SSR + hydration at both widths; it does not fix any screen layout.
  { app: "ShuttlePub", id: "home", path: "/", authenticated: false, data: "populated" },
  { app: "ShuttlePub", id: "not-found", path: "/visual-route-not-found", authenticated: false, data: "populated" },
] as const satisfies readonly {
  app: ScreenApp; id: string; path: string; authenticated: boolean; data: DataState; scenario?: string;
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
