# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ratcap is a PureScript web application using the Flame framework (Elm-like architecture) with SSR (Server-Side Rendering) + client-side hydration and History API-based routing.

## Development Environment

Development tools are managed via Nix flake + direnv. Entering the project directory automatically provides: `purs`, `spago`, `esbuild`, `watchexec`, `purs-backend-es`, `purescript-language-server`.

## Commands

- **Dev server (build + watch + serve):** `./scripts/dev.sh`
- **Build only:** `spago build`
- **Bundle client:** `spago bundle --platform browser --module Client --outfile dist/app.js`
- **Bundle server:** `spago bundle --platform node --module Server --outfile dist/server.js --bundle-type module`
- **Bundle CSS:** `bunx @tailwindcss/cli -i src/style.css -o dist/style.css`
- **Run tests:** `spago test`
- **BFF tests:** `bun test`
- **GraphQL codegen:** `bun scripts/sync-graphql.ts` (regenerate PureScript types from `bff/schema.graphql`)
- **All codegen (GraphQL + OpenAPI REST types):** `bun run codegen` / verify with `bun run codegen:check`
- **Install JS dependencies:** `bun install`

## Architecture

- **Language:** PureScript with Flame framework (Elm architecture: Model, Message, Update, View)
- **Routing:** `routing-duplex` for bidirectional URL codec, `routing` for PushState History API
- **SSR:** `Server.purs` renders full HTML via `Flame.Renderer.String`, with serialized state embedded in `<template-state>` for hydration
- **Client:** `Client.purs` hydrates SSR HTML via `Flame.resumeMount`, then handles client-side routing with `matchesWith`
- **Styling:** Tailwind CSS v4 — utility classes applied directly via `HA.class'` in PureScript views; `src/style.css` is the entry point with `@source "../src/**/*.purs"` to scan PureScript files for class names
- **Auth (BFF):** `index.ts` implements BFF (Backend-for-Frontend) auth — mock mode (built-in) and real mode (Kratos + Hydra OAuth2 PKCE). Session is stored in an AES-GCM encrypted HttpOnly cookie (`ratcap_session`).
- **Data API (BFF):** `bff/server.ts` serves `/graphql` via graphql-yoga. The schema is defined in `bff/schema.graphql` (single source of truth), with resolvers in `bff/resolvers.ts`. Session resolution happens in `bff/context.ts` via `SessionAdapter` DI. DataLoaders in `bff/loaders.ts` batch Emumet API calls per request. Errors use `extensions.code` (UNAUTHENTICATED / NOT_FOUND / INTERNAL_SERVER_ERROR). Set-Cookie via WeakMap + yoga onResponse plugin.
- **Dev server:** `index.ts` — Bun.serve() handles SSR (all routes), static files (`/app.js`, `/style.css`), auth endpoints (`/auth/*`), and GraphQL (`/graphql`)
- **Dev script:** `scripts/dev.sh` — triple bundle (client + server + CSS) + watchexec (auto-rebuild on `.purs` changes) + Tailwind `--watch` + Bun dev server
- **PureScript packages:** managed by `spago.yaml`, uses registry package set (includes `graphql-client` for /graphql queries)
- **JS dependencies:** managed by `package.json` / `bun.lock`

### Module Structure

```
bff/
  schema.graphql           -- GraphQL SDL (single source of truth for the data API)
  schema.ts                -- SDL loader + makeExecutableSchema
  server.ts                -- Yoga handler: createYogaHandler(adapter, createEmumetClient)
  context.ts               -- Session resolution + auth context (SessionAdapter DI)
  session.ts               -- Session foundation: seal/unseal, cookie helpers, refresh, SessionAdapter interface
  loaders.ts               -- DataLoader: profile + metadata, request-scoped, memoized per request
  resolvers.ts             -- Query/Mutation resolvers
  registration-gate-resolvers.ts -- Registration gate (D15) resolvers + error classification (extensions.code)
  registration-gate-status.ts -- Admin screen status chip (NOT_OPENED / OPEN / ... / OVERRIDE) and minimum-condition derivation (the only place that decides them)
  admin-ssr.ts             -- Admin page SSR initial state (viewer + gate) so the override warning is in the SSR HTML (index.ts passes it to renderPage)
  profile-identity-resolvers.ts -- Profile username resolvers (setProfileUsername / checkProfileUsername (形式・予約語は BFF、重複は Emumet の空き確認 API。確認できなければ UNKNOWN で VALID にしない) / Profile.usernameState) + extensions.code classification (USERNAME_* etc.)
  openapi/                 -- Pinned Emumet OpenAPI (lock verification, contract validation); see README
  emumet/
    client.ts              -- EmumetClient interface + DTOs (camelCase)
    real.ts                -- REST-backed EmumetClient (snake_case ↔ camelCase mapping)
    mock.ts                -- In-memory stateful MockEmumetClient
    registration-gate*.ts  -- Registration gate client contract / real / stateful mock / all-state fixtures / admin screen scenarios (mock only; POST /__mock/registration-gate/scenario in mock mode)
    profile-username.ts    -- Profile username rules (format / 17 reserved words; mirrors Emumet, checked against the pinned OpenAPI in tests)
    generated/             -- openapi-typescript output (never hand-edit; `bun run codegen`)
  *.test.ts                -- BFF test files (bun test)
src/
  style.css               -- Tailwind CSS entry point (@import "tailwindcss" + @source)
  Generated/               -- Auto-generated PureScript GraphQL types (from bff/schema.graphql via sync-graphql.ts; never hand-edit)
  App/
    Route.purs            -- Route ADT (Home, Settings, AccountNew, AccountDetail, Login, AdminRegistration, AdminWebhook) + routing-duplex codec
    Model.purs            -- Model type (Maybe Route, PageModel, SessionInfo, isHydrated) + JSON instances
    Username.purs         -- Profile username rules (mirror of Emumet), verdicts and the status line state; tested in test/Test/Main.purs
    Fixtures.purs         -- Every SSR state the username screens can be in (served by the hydration check in ui-catalog visual/screens/emumet-verify.ts via Server.renderFixture)
    Message.purs          -- Message ADT (Navigate, UrlChanged, CheckSession, Login/Logout, etc.)
    View.purs             -- Top-level view dispatcher
    Api/
      Client.purs         -- Generic HTTP client (Affjax-based: get, post, put, delete)
      Auth.purs           -- Auth API calls (login, checkSession, logout) via BFF /auth/* endpoints
      GraphQL.purs        -- GraphQL client (graphql-client): queries + mutations over /graphql
      RegistrationGate.purs -- Registration gate admin queries/mutations + GateError classification
      GraphQL/
        Types.purs        -- App-owned stable DTOs (AccountResponse, ProfileResponse, etc.)
    Admin/
      Types.purs          -- Admin (registration gate) model, messages, DTOs
      Text.purs           -- All admin screen wording and status colours (single place)
      Time.purs           -- Event time formatting (HH:MM today, MM/DD otherwise) + focus FFI
    View/
      Layout.purs         -- HTML shell (<html>/<head>/<body>) + auth-aware navigation
      Login.purs          -- Login page view (email + password form)
      Accounts.purs       -- Account list view (@username@host, unset label, "+" opens the create modal)
      AccountNew.purs     -- Create-account modal (name / username / Bot, then the "cannot be changed" confirmation); /accounts/new = the list with the modal open
      UsernameUi.purs     -- Shared username input, status line, confirmation and modal frame (native <dialog>)
      UsernameHelp.purs   -- Help page for the username rules (the (?) in the input links here: /help/username)
      AccountDetail.purs  -- Account detail/edit view
      Settings.purs       -- Settings page view
      Admin.purs          -- Registration gate admin pages (一般登録 / Webhook tabs), override warning strip, notification bell
      NotFound.purs       -- 404 view
      Link.purs           -- SPA <a> with preventDefault + Navigate message
    Theme.purs            -- Semantic Tailwind class helpers (Catppuccin-mocha theme)
    Format.purs           -- Date/time formatting helpers
  Client.purs             -- Client entry: resumeMount + CheckSession + route subscription
  Client/
    Update.purs           -- Client update function (auth, navigation, API calls)
    Admin.purs            -- Registration gate admin update (viewer hint, gate commands, notifications, webhook)
    Navigation.js         -- FFI: window.location.assign for full-page redirects
    Navigation.purs       -- PureScript binding for navigation FFI
    Fetch.js              -- FFI: alternative fetch implementation (unused)
    Fetch.purs            -- Alternative fetch module with bearer token (unused)
    Dialog.js / Dialog.purs -- Makes the username <dialog>s real modals (showModal, focus in/out, Tab wrap, Escape)
  Server.purs             -- Server entry: renderPage for SSR HTML generation
scripts/
  dev.sh                  -- Dev server (build + watch + serve)
  register-hydra-client.ts -- Register OAuth2 client in Hydra (real mode setup)
  sync-graphql.ts         -- Generate PureScript types from bff/schema.graphql (SDL → introspection → src/Generated/)
```

### Key Design Decisions

- **Single package + App namespace:** View is shared between server/client, so workspace separation adds no benefit
- **Mount selector `main#app`:** Flame hydration requires the mount selector to match the view's root element, not `body`
- **`Maybe Route` in Model:** Unknown URLs map to `Nothing` → `PageModel.NotFound`, since `routing-duplex` `sum` requires all constructors
- **`mkUpdate nav` closure:** PushStateInterface is not serializable, so it's injected via closure rather than stored in Model
- **`isHydrated` flag:** Prevents data re-fetch on initial `matchesWith` callback firing

## Tooling Preferences

- Use **Bun** instead of Node.js for all JS/TS execution and package management.
- Use **Bun.serve()** for serving, not express or vite.
- Use `bun index.ts` (not `bun run index.ts`) to avoid Bun's module cache issues with rebuilt bundles.
- PureScript source changes require `spago bundle` to regenerate `dist/app.js` and `dist/server.js`. The dev script handles this automatically.
- Tailwind CSS classes are used directly in PureScript views via `HA.class' "..."`. New classes in `.purs` files are automatically picked up by Tailwind's `@source` directive.
- When adding a new static file to `dist/`, a corresponding route must be added in `index.ts`.
