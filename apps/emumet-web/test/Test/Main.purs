module Test.Main where

import Prelude

import App.Admin.Types (AdminMsg(AdminForbidden, CommandDone, GateLoaded, MoreNotificationsLoaded, NotificationsLoaded, ViewerLoaded, ViewerUnavailable), Gate, GateCommand(..), Loadable(..), acceptGate, emptyAdminModel)
import App.Model (Model, RemoteData(NotAsked), emptyNewAccountForm, pageForMaybeRoute)
import App.Route (Route(..))
import App.Username (Local(..), Reason(..), Status(..), Verdict(..), isAvailable, shouldAskServer, status, validate)
import App.View (view)
import Client.Admin (updateAdmin)
import Data.Array (replicate)
import Data.Foldable (for_)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.String.CodeUnits (fromCharArray)
import Data.Tuple (fst)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Flame.Renderer.String as FRS
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind(..))
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus(..))
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus(..))
import Server (renderPage)
import Test.UpdateSpec as UpdateSpec
import Test.Util (check)

-- | Local username rules mirror Emumet (E8/P1): ^[a-z0-9][a-z0-9._-]{0,63}$ + 17 reserved
-- | words, with no implicit trimming or case folding.

usernameTests :: Effect Unit
usernameTests = do
  -- accepted
  for_ [ "alice", "a", "0", "a.b", "a_b", "a-b", "a1.b2_c3-d4", "9lives" ] \u ->
    check ("valid " <> u) LocalOk (validate u)
  check "64 chars" LocalOk (validate (fromCharArray (replicate 64 'a')))

  -- rejected by format (no trimming, no case folding)
  check "empty" Empty (validate "")
  check "65 chars" TooLong (validate (fromCharArray (replicate 65 'a')))
  for_ [ "Alice", "ALICE", "aLice", " alice", "alice ", "alice\n", "admin\n", "_a", ".a", "-a", "a b", "a@b", "a/b", "ａlice", "日本語" ] \u ->
    check ("bad format " <> show u) BadFormat (validate u)

  -- the 17 reserved words
  for_
    [ "admin", "administrator", "root", "system", "support", "security", "moderator", "api", "ap", "auth", "oauth", "oauth2", "login", "logout", "register", "settings", "well-known" ]
    \u -> check ("reserved " <> u) Reserved (validate u)
  check "reserved is exact (admin1 ok)" LocalOk (validate "admin1")
  check "reserved is case sensitive (Admin is a format error)" BadFormat (validate "Admin")

  -- status line
  check "status empty" NoStatus (status "" Unverified)
  check "status pending" Checking (status "alice" Unverified)
  check "status verified" Available (status "alice" Verified)
  check "status taken" (Unusable "利用できません") (status "alice" Taken)
  check "status unconfirmed (429 / connection trouble) is neither available nor refused" (Unconfirmed "空き状況を確認できませんでした") (status "alice" Unavailable)
  check "an unconfirmed value cannot be submitted" false (isAvailable "alice" Unavailable)
  check "status reserved (local)" (Unusable "利用できません") (status "admin" Verified)
  check "status server-rejected format" (Unusable "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます") (status "alice" (Rejected ReasonFormat))
  check "status uppercase is an error, not converted" (Unusable "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます") (status "Alice" Verified)

  -- the buttons
  check "available only when verified" true (isAvailable "alice" Verified)
  check "not available while unverified" false (isAvailable "alice" Unverified)
  check "verdict of another value never makes a bad value available" false (isAvailable "Alice" Verified)
  check "ask the server only for locally valid values" true (shouldAskServer "alice")
  check "do not ask for invalid values" false (shouldAskServer "Alice")
  log "all App.Username tests passed"
  UpdateSpec.run
  log "all update tests passed"

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
  , sessionVerified: true
  , loginForm: { identifier: "", password: "" }
  , accounts: NotAsked
  , selectedAccount: NotAsked
  , newAccountForm: emptyNewAccountForm
  , editProfileForm: Nothing
  , editMetadataForm: Nothing
  , setUsernameDialog: Nothing
  , instanceHost: NotAsked
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

adminTests :: Effect Unit
adminTests = do
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

  -- SSR で強制開放中と分かっている管理者: hydration 後の viewer 再取得が一時障害 (503) でも警告帯と状態を失効させない
  let
    fromSsr = adminModel { admin = adminModel.admin { gate = Loaded opened } }
    afterViewer503 = fst (updateAdmin fromSsr ViewerUnavailable)
  assert "viewer 503 after SSR keeps the admin hint" (afterViewer503.admin.isAdmin == Just true)
  assert "viewer 503 after SSR keeps the override state" (overrideShown afterViewer503)
  html503 <- FRS.render (view afterViewer503)
  assert "viewer 503 after SSR still renders the warning strip" (contains (Pattern "data-testid=\"override-strip\"") html503)
  assert "viewer 503 after SSR does not render the 404 page" (contains (Pattern "data-testid=\"admin-page\"") html503)
  let unknown503 = fst (updateAdmin (adminModel { admin = emptyAdminModel }) ViewerUnavailable)
  assert "viewer 503 without any prior knowledge stays fail closed" (unknown503.admin.isAdmin == Just false)

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

main :: Effect Unit
main = do
  usernameTests
  adminTests
