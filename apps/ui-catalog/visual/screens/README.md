# Application screens

The current capture driver runs the built **Booskiff** and **Emumet** applications
from `FRONTEND_ROOT`. Run this same driver for both the main checkout and the PR
checkout; the main checkout does not need to contain this directory.

```sh
# Build both apps first with the current visual/build.sh, passing the target app directory.
FRONTEND_ROOT=/absolute/path/to/frontend-checkout \
CAPTURE_DIR=/absolute/path/to/expected-or-actual \
bun visual/screens/capture.ts

bun test visual/screens
```

`CAPTURE_DIR` is shared with catalog captures. The driver only writes its own
`Booskiff-*.png` and `Emumet-*.png` files. Ports are allocated automatically, both
Bun app servers and the Core fixture server are stopped on success or failure.
Unresponsive child servers receive SIGKILL after a one-second SIGTERM grace period.
Relative environment paths resolve against the shell's current directory;
the default `FRONTEND_ROOT` is the checkout containing the capture driver.
The browser comes from ui-catalog's pinned `@playwright/test`; install that
version's Chromium, or use `PLAYWRIGHT_CHROMIUM_PATH` for a local Nix browser.
Use the same browser, OS and fonts for main and PR captures.

## Coverage

`SCREEN_CASES` in `cases.ts` is the reusable, serializable inventory. Each state
is captured at 1280×900 and 390×844, at device scale 1, with a full-page screenshot:

- ShuttlePub (SNS shell, host ui-spec v6): home timeline, post detail, compose form (filled), compose
  visibility menu, Profile switcher menu (desktop dropdown / mobile bottom sheet), settings, 404, in mock
  mode. Cases wait for the hydration marker and the fixtures served through the BFF, then open
  the overlay they photograph. The `home` case also understands the older F0 placeholder so main still
  captures. The FA login UI (`/login`, its denied / failed reasons, the signed-out and session-expired home)
  is captured with a `viewer` against a second, real-mode BFF whose backend is `shuttlepub-stub.ts`
  (no IdP is contacted; only the expected UNAUTHENTICATED / NOT_IMPLEMENTED GraphQL errors are allowed).
  `shuttlepub-verify.ts` additionally checks hydration, keyboard/focus behaviour, real-mode 501/500 and
  the login flow up to a stub provider's denial.
- Booskiff: login, populated Drive, empty Drive, selected folder, file detail, 404.
- Emumet: login, populated accounts, new account, filled bot account form,
  account detail, profile edit form, settings, 404. The username screens
  (cases with `requires: "emumet-username-ui"` in `cases.ts`: invalid / reserved / too long / taken input,
  create confirmation, unset profile notice, one-time set dialog with its
  invalid / taken / confirmation / already-set states, and the help page) exist only on
  revisions whose SSR page carries the username dialog (`data-username-dialog`, see
  `features.ts`); the baseline skips them (`CAPTURE_SIDE=baseline`, reported as New) and the
  branch fails if they are missing or do not render.
  `emumet-verify.ts` (run from the same CI job) additionally checks behaviour a screenshot cannot prove:
  every state of `App.Fixtures` is served as the SSR page and must be resumed by the browser without any DOM
  change or error, and the dialogs are driven with the keyboard (focus in, Tab wrap, Escape, focus restored, (?) link).
  Cases that write to the mock Emumet (`MUTATES_SERVER`) make the driver restart that app afterwards;
  GraphQL errors a case is meant to provoke are listed in `EXPECTED_GRAPHQL_CODES`.

The fixed app theme is Catppuccin Mocha / Rounded; the component catalog covers
the theme combinations. These are UI-review fixtures, not a substitute for
Core/OIDC integration tests or a test of mutation persistence.

## Determinism and failure behavior

- Unmodified `index.ts` entrypoints serve the real SSR HTML, CSS and client bundle.
  A missing build, missing serialized SSR state or missing hydration session
  request fails the capture.
- Booskiff uses its existing mock authentication and checked-in E2E test signing
  key. Data still passes through the real BFF and REST client into a loopback
  HTTP fixture server. `fixtures.ts` follows the production DTO types and
  `screens.test.ts` verifies the snake_case wire format with the production
  REST client. Unexpected requests and writes fail.
- Emumet uses the existing built-in mock authentication/data. Its checked-in
  Alice/Bob/bot external avatar and banner URLs resolve to local static SVG
  fixtures; any other external network request fails.
- The child-server preload restricts BFF `fetch`/`fetch.preconnect` to the Core
  fixture origin and rejects redirects. Violations are recorded synchronously
  outside the app process and fail capture even if the application catches the
  request error. This covers the applications' current fetch-based HTTP clients.
- The child-server-only preload fixes `new Date()` and `Date.now()`. Playwright
  fixes the browser clock at the same instant, while timers still run. Locale,
  UTC timezone, theme and viewport are explicit. Each capture gets a fresh
  browser context; Drive data state resets for each case.
- Readiness checks assert actual data/form state. Font and image decoding finish
  before capture; screenshot animations and carets are disabled. Unexpected
  browser exceptions, console errors, HTTP/GraphQL errors, incomplete loading
  or broken images fail instead of producing a misleading comparison. The
  logged-out login page's expected `/auth/session` 401 is narrowly permitted.

## Adding a route or state

1. Add its app, stable ID, route and authentication/data requirements to
   `routes` in `cases.ts`. Filenames must remain unique and match
   `^[A-Za-z0-9-]+\.png$`; the viewport expansion happens automatically.
2. Extend `prepareScreen` in `capture.ts` with a meaningful ready-state assertion
   and any UI actions needed to expose the new state. Keep actions local to the
   fresh browser context; add an explicit reset before introducing server data
   mutations. Prefer structural/test-ID selectors and seeded data values, so
   editing headings, button labels or placeholders can produce a screenshot diff.
   Do not replace application HTML or bypass its data client.
3. Extend typed fixtures and the HTTP contract tests if the screen requires a
   new Core endpoint. Only allow a new external resource with an explicit local
   fixture. Prefer fixed IDs, dates and image content.
4. Run the focused tests, visual TypeScript check, and capture the same revision
   twice. Compare those outputs before relying on a main-vs-PR difference.

If an intentionally new route does not exist on main, introduce an explicit
baseline case/version policy in the driver and report it as added coverage;
do not silently accept a 404, auth redirect or empty loading state as its baseline.
The policy in use: give the case `requires: <feature>` (`cases.ts` `ScreenFeature`) and detect the
feature from the running app (`features.ts`). With `CAPTURE_SIDE=baseline` (the workflow's main
capture) such a case is skipped and compare lists it as New; on the branch side (the default) a
missing feature fails the capture.
