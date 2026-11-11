module Test.Main where

import Prelude

import App.Admin.Types (AdminMsg(..), Gate, GateCommand(..), Loadable(..), acceptGate, emptyAdminModel)
import App.Model (Model, RemoteData(NotAsked), pageForMaybeRoute)
import App.Route (Route(..))
import Client.Admin (updateAdmin)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.Tuple (fst)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind(..))
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus(..))
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus(..))
import Server (renderPage)

assert :: String -> Boolean -> Effect Unit
assert name ok = if ok then log ("ok - " <> name) else throw ("FAILED - " <> name)

gate :: Int -> RegistrationGateStatus -> Boolean -> Gate
gate revision status overrideActive =
  { revision, status, minimumMet: false, adminOpen: true, overrideActive, enforcementVerified: true }

adminModel :: Model
adminModel =
  { route: Just AdminRegistration
  , page: pageForMaybeRoute (Just AdminRegistration)
  , isHydrated: true
  , session: Just { username: "admin" }
  , loginForm: { identifier: "", password: "" }
  , accounts: NotAsked
  , selectedAccount: NotAsked
  , newAccountForm: { name: "", isBot: false }
  , editProfileForm: Nothing
  , editMetadataForm: Nothing
  , errorMessage: Nothing
  , savePending: false
  , saveGeneration: 0
  , admin: emptyAdminModel { isAdmin = Just true }
  }

revisionOf :: Model -> Maybe Int
revisionOf model = case model.admin.gate of
  Loaded g -> Just g.revision
  _ -> Nothing

overrideShown :: Model -> Boolean
overrideShown model = case model.admin.gate of
  Loaded g -> g.overrideActive
  _ -> false

main :: Effect Unit
main = do
  -- 遅れて届いた古い GET が、操作で進んだ状態 (強制開放) を巻き戻さない
  let
    opened = gate 14 OVERRIDE true
    stale = gate 13 NOT_OPENED false
    afterCommand = fst (updateAdmin adminModel (CommandDone EnableOverride opened))
    afterStale = fst (updateAdmin afterCommand (GateLoaded stale))
  assert "stale GET after a command keeps the newer revision" (revisionOf afterStale == Just 14)
  assert "stale GET after a command keeps the override warning" (overrideShown afterStale)
  let afterFresh = fst (updateAdmin afterStale (GateLoaded (gate 15 OPEN false)))
  assert "a newer GET is applied" (revisionOf afterFresh == Just 15)
  assert "acceptGate keeps the known state for an older revision" case acceptGate (Loaded opened) stale of
    Loaded g -> g.revision == 14
    _ -> false
  assert "acceptGate accepts the same revision (refetch of the current state)" case acceptGate (Loaded opened) (opened { minimumMet = true }) of
    Loaded g -> g.minimumMet
    _ -> false

  -- FORBIDDEN は管理画面の状態と導線を捨て、後から viewer が管理者と返しても戻さない
  let
    forbidden = fst (updateAdmin afterCommand AdminForbidden)
    reAdmitted = fst (updateAdmin forbidden (ViewerLoaded true))
  assert "FORBIDDEN revokes the admin hint" (forbidden.admin.isAdmin == Just false)
  assert "FORBIDDEN drops the cached gate (no warning strip)" (not (overrideShown forbidden))
  assert "a later viewer=admin does not re-open the admin screens" (reAdmitted.admin.isAdmin == Just false)

  -- 通知の次のページは重複を除いて後ろに足す
  let
    note id = { id, kind: OUTAGE_STARTED, read: false, createdAt: "2026-11-10T03:00:00Z", email: obs, bot: obs }
    obs = { configured: true, probe: HEALTHY }
    firstPage = fst (updateAdmin adminModel (NotificationsLoaded { items: [ note "3", note "2" ], unread: 3, nextCursor: Just "2" }))
    secondPage = fst (updateAdmin firstPage (MoreNotificationsLoaded { items: [ note "2", note "1" ], unread: 3, nextCursor: Nothing }))
  assert "next page is appended without duplicates" (map _.id secondPage.admin.notifications == [ "3", "2", "1" ])
  assert "last page clears the cursor" (secondPage.admin.notificationsCursor == Nothing)

  -- SSR: 管理画面の初期状態を渡すと、警告帯と状態チップが SSR の HTML に含まれ、そのまま hydration できる
  let ssrState = """{"username":"admin","isAdmin":true,"forbidden":false,"gate":{"revision":14,"status":"OVERRIDE","minimumMet":false,"adminOpen":true,"overrideActive":true,"enforcementVerified":true}}"""
  withOverride <- renderPage "/admin/registration" ssrState
  assert "SSR renders the override warning strip" (contains (Pattern "data-testid=\"override-strip\"") withOverride)
  assert "SSR renders the gate status" (contains (Pattern "data-status=\"OVERRIDE\"") withOverride)
  assert "SSR serializes the admin state for hydration" (contains (Pattern "overrideActive") withOverride)
  onWebhook <- renderPage "/admin/webhook" ssrState
  assert "SSR renders the strip on every admin page" (contains (Pattern "data-testid=\"override-strip\"") onWebhook)
  general <- renderPage "/" ssrState
  assert "SSR never renders the strip on general pages" (not (contains (Pattern "data-testid=\"override-strip\"") general))
  noState <- renderPage "/admin/registration" ""
  assert "SSR without admin state renders no admin data" (not (contains (Pattern "data-testid=\"override-strip\"") noState))
  forbiddenSsr <- renderPage "/admin/registration" """{"username":"member","isAdmin":false,"forbidden":true,"gate":null}"""
  assert "SSR for a non-admin renders the 404 page, not the admin page" (not (contains (Pattern "data-testid=\"admin-page\"") forbiddenSsr))
