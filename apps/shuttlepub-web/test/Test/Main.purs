module Test.Main where

import Prelude

import App.Api.Error (ApiError(..), describe, fromGqlCode, isSignedOut, tag, withReason)
import App.Dom (fullDateTime, relativeTime)
import App.Model (DetailTab(..), Model, RemoteData(..), emptyCompose, fromEither, initialModel)
import App.Model as AppModel
import App.MuteBlock.Types as MuteBlock
import App.MuteBlock.Types (Change(..), Dialog(..), Failure(..), InputProblem(..), Message(..), Undo(..), Write(..))
import App.MuteBlock.Update as MuteBlockUpdate
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))
import App.Post (Post, PostView, Quoted(..), TimelineTab(..), Visibility(..), allowedOperations, allTimelineTabs, timelineTabFromValue, timelineTabValue)
import App.Reaction (ToastKind(..))
import App.Route (Route(..), routeCodec)
import App.View (view)
import App.View.Auth (authActionId, authActionShown)
import App.View.Common (loginHref)
import App.View.Shell (profileButtonDesktopId, profileButtonMobileId)
import Client.Update (mkUpdate, visibleOpener)
import App.Message as App
import Unsafe.Coerce (unsafeCoerce)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Either (Either(..), hush)
import Data.Array (length)
import Data.Foldable (for_)
import Data.Maybe (Maybe(..), isJust)
import Data.String (Pattern(..), contains, split)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Flame.Renderer.String as FRS
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))
import Routing.Duplex (parse, print)
import Server (renderPage)
import Test.Reaction (testReaction)

main :: Effect Unit
main = do
  log "shuttlepub-web tests"
  testRouteCodec
  testModelRoundTrip
  testErrorMapping
  testTimelineTabs
  testTimeFormatting
  testSsr
  testMuteBlock
  testReaction
  testLoginHref
  testLoginScreens
  testLoginFocusTargets
  testPostDisplay

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual label actual expected =
  unless (actual == expected)
    (throw (label <> " - expected " <> show expected <> ", got " <> show actual))

assertTrue :: String -> Boolean -> Effect Unit
assertTrue label ok = assertEqual label ok true

assertContains :: String -> String -> String -> Effect Unit
assertContains label haystack needle =
  assertTrue (label <> " contains " <> show needle) (contains (Pattern needle) haystack)

assertNotContains :: String -> String -> String -> Effect Unit
assertNotContains label haystack needle =
  assertTrue (label <> " does not contain " <> show needle) (not (contains (Pattern needle) haystack))

roundTrip :: forall a. Eq a => Show a => EncodeJson a => DecodeJson a => String -> a -> Effect Unit
roundTrip label value = case hush (decodeJson (encodeJson value)) of
  Just decoded -> assertEqual label decoded value
  Nothing -> throw (label <> " - decode failed")

testRouteCodec :: Effect Unit
testRouteCodec = do
  let
    cases =
      [ { path: "/", route: Home }
      , { path: "/notifications", route: Notifications }
      , { path: "/search", route: Search }
      , { path: "/bookmarks", route: Bookmarks }
      , { path: "/settings", route: Settings }
      , { path: "/posts/post-sora-zine", route: PostDetail "post-sora-zine" }
      , { path: "/login", route: Login { error: Nothing } }
      , { path: "/login?error=denied", route: Login { error: Just "denied" } }
      ]
  for_ cases \{ path, route } -> do
    assertEqual ("parse " <> path) (hush (parse routeCodec path)) (Just route)
    assertEqual ("print " <> path) (print routeCodec route) path
    roundTrip ("route " <> path) route
  assertEqual "parse unknown path" (hush (parse routeCodec "/nope")) Nothing
  assertEqual "posts needs an id" (hush (parse routeCodec "/posts")) Nothing
  assertEqual "parse mute-block domains" (hush (parse routeCodec "/settings/mute-block/domains")) (Just MuteBlockDomains)
  assertEqual "parse mute-block accounts" (hush (parse routeCodec "/settings/mute-block/accounts")) (Just MuteBlockAccounts)
  assertEqual "print mute-block domains" (print routeCodec MuteBlockDomains) "/settings/mute-block/domains"
  assertEqual "mute-block root is not a page" (hush (parse routeCodec "/settings/mute-block")) Nothing

samplePost :: Post
samplePost =
  { id: "post-1"
  , noteId: "5f0c1a2e-7b3d-4e21-9c55-000000000001"
  , author: { id: "author-1", handle: "mika@misskey.example", displayName: "Mika", actorUrl: "https://misskey.example/users/mika", domain: "misskey.example", local: false }
  , text: "hello\nworld"
  , createdAt: "2026-01-15T11:55:00.000Z"
  , replyCount: 0
  , repostCount: 1
  , repostedBy: Just { id: "author-2", handle: "ren@shuttlepub.example", displayName: "Ren", actorUrl: "https://shuttlepub.example/users/ren", domain: "shuttlepub.example", local: true }
  , inReplyToId: Nothing
  , quoted: Nothing
  }

-- | A quote whose target S8 keeps hidden (the shape a revealed quote of a muted post has).
quotePost :: Post
quotePost = samplePost
  { id = "post-quote"
  , repostedBy = Nothing
  , quoted = Just (Quoted { post: Nothing, hidden: Just { mode: MUTE, domain: "noisy.social", revision: 3 }, restriction: Nothing })
  }

hiddenView :: PostView
hiddenView = { id: "post-hidden", post: Nothing, hidden: Just { mode: BLOCK, domain: "bot-farm.example", revision: 2 }, restriction: Nothing, operations: Nothing }

visibleView :: PostView
visibleView =
  { id: "post-1"
  , post: Just samplePost
  , hidden: Nothing
  , restriction: Nothing
  , operations: Just allowedOperations { reply = Just { mode: BLOCK, domain: "bot-farm.example", revision: 2 } }
  }

testModelRoundTrip :: Effect Unit
testModelRoundTrip = do
  roundTrip "initial model" (initialModel (Just Home))
  roundTrip "initial model (unknown route)" (initialModel Nothing)
  roundTrip "initial model (detail)" (initialModel (Just (PostDetail "post-1")))
  let
    profile = { id: "p1", handle: "alice", displayName: "Alice" }

    loaded :: Model
    loaded = (initialModel (Just Home))
      { isHydrated = true
      , isMobile = true
      , now = 1768478400000.0
      , apiMode = Loaded MOCK
      , apiStatus = Loaded { apiVersion: "v1" }
      , profileContext = Loaded { activeProfile: Just profile }
      , availableProfiles = Loaded [ profile ]
      , timelineTab = LocalTimeline
      , timeline = Loaded [ samplePost ]
      , detail = Loaded { view: Just visibleView, replies: [ visibleView, hiddenView, visibleView { post = Just quotePost } ] }
      , detailTab = ReactionsTab
      , compose = Just ((emptyCompose "sp-compose-desktop") { text = "draft", visibility = FollowersOnly, error = Just (NotImplemented "later") })
      , profileMenu = Just { opener: "sp-profile-desktop", error: Nothing }
      }

    failed :: Model
    failed = (initialModel (Just Home))
      { isHydrated = true
      , apiMode = Loaded REAL
      , apiStatus = Failed (NotImplemented "later")
      , profileContext = Failed (Unavailable "down")
      , timeline = Failed (NotImplemented "no endpoint")
      }
  roundTrip "loaded model" loaded
  roundTrip "failed model" failed
  roundTrip "loading model" (((initialModel (Just Home)) { apiStatus = Loading, timeline = Loading }) :: Model)

testErrorMapping :: Effect Unit
testErrorMapping = do
  assertEqual "UNAUTHENTICATED" (fromGqlCode (Just "UNAUTHENTICATED") "m") (Unauthenticated "m")
  assertEqual "FORBIDDEN" (fromGqlCode (Just "FORBIDDEN") "m") (Forbidden "m")
  assertEqual "PROFILE_UNAVAILABLE" (fromGqlCode (Just "PROFILE_UNAVAILABLE") "m") (ProfileUnavailable "m")
  roundTrip "unauthenticated error" (Unauthenticated "m")
  assertEqual "unauthenticated tag" (tag (Unauthenticated "m")) "unauthenticated"
  assertEqual "NOT_IMPLEMENTED" (fromGqlCode (Just "NOT_IMPLEMENTED") "m") (NotImplemented "m")
  assertEqual "UPSTREAM_ERROR" (fromGqlCode (Just "UPSTREAM_ERROR") "m") (UpstreamError "m")
  assertEqual "UPSTREAM_UNAVAILABLE" (fromGqlCode (Just "UPSTREAM_UNAVAILABLE") "m") (Unavailable "m")
  assertEqual "INVALID_UPSTREAM_RESPONSE" (fromGqlCode (Just "INVALID_UPSTREAM_RESPONSE") "m") (InvalidResponse "m")
  assertEqual "unknown code" (fromGqlCode (Just "WHATEVER") "m") (Unexpected "m")
  assertEqual "no code" (fromGqlCode Nothing "m") (Unexpected "m")
  -- extensions.reason refines only an UNAUTHENTICATED error.
  assertEqual "expired session" (withReason (Just "SESSION_EXPIRED") (Unauthenticated "m")) (SessionExpired "m")
  assertEqual "no reason" (withReason Nothing (Unauthenticated "m")) (Unauthenticated "m")
  assertEqual "unknown reason" (withReason (Just "OTHER") (Unauthenticated "m")) (Unauthenticated "m")
  assertEqual "reason on another code" (withReason (Just "SESSION_EXPIRED") (Forbidden "m")) (Forbidden "m")
  assertEqual "expired tag" (tag (SessionExpired "m")) "session_expired"
  assertTrue "expired is signed out" (isSignedOut (SessionExpired "m"))
  assertTrue "unauthenticated is signed out" (isSignedOut (Unauthenticated "m"))
  assertTrue "forbidden keeps the session" (not (isSignedOut (Forbidden "m")))
  roundTrip "expired error" (SessionExpired "m")
  assertEqual "tag" (tag (NotImplemented "m")) "not_implemented"
  assertContains "describe" (describe (NotImplemented "later")) "Not implemented: later"
  -- A failure stays a failure: it never becomes Loaded.
  assertEqual "Left stays Failed" (fromEither (Left (NotImplemented "m") :: Either ApiError Int)) (Failed (NotImplemented "m"))
  assertEqual "Right is Loaded" (fromEither (Right 1 :: Either ApiError Int)) (Loaded 1)

testTimelineTabs :: Effect Unit
testTimelineTabs = do
  for_ allTimelineTabs \tab ->
    assertEqual ("tab value " <> timelineTabValue tab) (timelineTabFromValue (timelineTabValue tab)) (Just tab)
  assertEqual "unknown tab value" (timelineTabFromValue "global") Nothing
  roundTrip "timeline tab" FederatedTimeline
  roundTrip "visibility" Direct

testTimeFormatting :: Effect Unit
testTimeFormatting = do
  let
    -- 2026-01-15T12:00:00Z, the visual capture clock.
    now = 1768478400000.0
  assertEqual "seconds" (relativeTime now "2026-01-15T11:59:30.000Z") "たった今"
  assertEqual "minutes" (relativeTime now "2026-01-15T11:55:00.000Z") "5分前"
  assertEqual "hours" (relativeTime now "2026-01-15T09:00:00.000Z") "3時間前"
  assertEqual "days" (relativeTime now "2026-01-12T12:00:00.000Z") "3日前"
  assertEqual "old posts show the date" (relativeTime now "2025-11-01T12:00:00.000Z") "2025/11/01"
  assertEqual "unparsable stays as is" (relativeTime now "not a date") "not a date"
  assertEqual "unparsable full date stays as is" (fullDateTime "not a date") "not a date"

testSsr :: Effect Unit
testSsr = do
  home <- renderPage "/"
  assertContains "home SSR" home "id=\"app\""
  assertContains "home SSR" home "template-state"
  assertContains "home SSR marks SSR" home "data-hydration=\"ssr\""
  assertContains "home SSR heading" home "ホーム"
  assertContains "home SSR timeline tabs" home "role=\"tablist\""
  -- SSR must not claim to know data the client has not fetched yet.
  assertContains "home SSR timeline is loading" home "data-testid=\"timeline\" data-state=\"loading\""
  assertNotContains "home SSR has no posts" home "sp-post\""
  assertNotContains "home SSR has no profile" home "Fixture Profile"
  -- Desktop (sidebar) and mobile (tab bar) chrome are both server-rendered; CSS picks one.
  assertContains "home SSR sidebar" home "sp-sidebar"
  assertContains "home SSR tab bar" home "sp-tabbar"
  assertContains "home SSR compose entry" home "投稿する"
  assertNotContains "home SSR" home "not-found"
  detail <- renderPage "/posts/post-sora-zine"
  assertContains "detail SSR heading" detail ">投稿</h1>"
  assertContains "detail SSR is loading" detail "data-testid=\"post-detail\" data-state=\"loading\""
  settings <- renderPage "/settings"
  assertContains "settings SSR" settings "設定"
  missing <- renderPage "/nope"
  assertContains "unknown path SSR" missing "404"
  assertNotContains "unknown path SSR" missing "role=\"tablist\""
  for_ [ "/", "/posts/post-sora-zine", "/settings", "/notifications", "/search", "/bookmarks", "/login", "/nope" ] \path -> do
    html <- renderPage path
    assertContains ("SSR " <> path) html "data-testid=\"app-shell\""
    assertNotContains ("SSR " <> path) html "undefined"

-- | D08 mute/block settings page: SSR shell, state round trip and the update
-- | rules that keep writes honest (no silent success, no double write).
testMuteBlock :: Effect Unit
testMuteBlock = do
  page <- renderPage "/settings/mute-block/domains"
  assertContains "mute-block SSR" page "ミュート・ブロック"
  assertContains "mute-block SSR claims no data" page "読み込み中"
  assertContains "mute-block SSR tabs" page "/settings/mute-block/accounts"
  assertNotContains "mute-block SSR" page "undefined"
  let
    muted = { domain: "noisy.social", mode: MUTE, revision: 3, createdAt: "2025-11-30T09:00:00Z" }
    blocked = { domain: "bot-farm.example", mode: BLOCK, revision: 1, createdAt: "2025-12-20T09:00:00Z" }
    ready = MuteBlock.init { profile = Just "acc-1", profileKnown = true, domains = MuteBlock.Ready [ muted, blocked ], actors = MuteBlock.Ready [] }
    step model message = case MuteBlockUpdate.update model message of
      Tuple next effects -> { next, effects: length effects }
    row = { profile: "acc-1", epoch: 0, dialog: false }
    fromDialog = { profile: "acc-1", epoch: 0, dialog: true }
  roundTrip "mute-block model" (ready { dialog = Just (ConfirmBlock { domain: "example.social", current: Nothing, fromInput: true, impact: MuteBlock.Ready { following: [ "https://example.social/users/a" ], followers: [] }, acknowledged: false, pending: false, failure: Nothing }) })
  roundTrip "app model with mute-block" ((initialModel (Just MuteBlockDomains)) { muteBlock = ready } :: AppModel.Model)
  let none = step MuteBlock.init (ProfileKnown (Right Nothing))
  assertEqual "no profile is an error, not an empty list" none.next.domains (MuteBlock.Failed (Failure "PROFILE_REQUIRED"))
  let known = step MuteBlock.init (ProfileKnown (Right (Just "acc-1")))
  assertEqual "a known profile loads both lists" known.effects 2
  assertEqual "stale list response is dropped" (step ready (DomainsLoaded { profile: "acc-2", epoch: 0 } (Right []))).next.domains ready.domains
  let adding = ready { dialog = Just (AddDomain { input: "noisy.social", problem: Nothing, pending: true }) }
  assertEqual "adding the same mode again is refused"
    (step adding (AddChecked MUTE (Right { domain: Just "noisy.social", error: Nothing }))).next.dialog
    (Just (AddDomain { input: "noisy.social", problem: Just (AlreadySet MUTE), pending: false }))
  assertEqual "a refused input shows its reason"
    (step adding (AddChecked MUTE (Right { domain: Nothing, error: Just "WILDCARD" }))).next.dialog
    (Just (AddDomain { input: "noisy.social", problem: Just (InputRefused "WILDCARD"), pending: false }))
  let blockingMuted = step adding (AddChecked BLOCK (Right { domain: Just "noisy.social", error: Nothing }))
  case blockingMuted.next.dialog of
    Just (ConfirmBlock state) -> do
      assertEqual "blocking a muted domain replaces its revision" (map _.revision state.current) (Just 3)
      assertEqual "impact is loaded before blocking" state.impact MuteBlock.Loading
    _ -> throw "expected the block confirmation"
  let
    detaching = ready { dialog = Just (ConfirmBlock { domain: "example.social", current: Nothing, fromInput: true, impact: MuteBlock.Ready { following: [ "https://example.social/users/a" ], followers: [] }, acknowledged: false, pending: false, failure: Nothing }) }
  assertEqual "detaching follows needs the acknowledgement" (step detaching ConfirmBlockDomain).effects 0
  let acknowledged = step (step detaching (ToggleAcknowledged true)).next ConfirmBlockDomain
  assertEqual "acknowledged block writes once" acknowledged.effects 1
  assertTrue "pending block is not sent twice" ((step acknowledged.next ConfirmBlockDomain).effects == 0)
  let
    writing = ready { writing = true }
  assertEqual "no second write while one is in flight" (step writing (UnmuteDomain muted)).effects 0
  let unmuted = step (ready { writing = true }) (Written row UnmuteDomainRow "noisy.social" (Right (DomainRemoved "noisy.social")))
  assertEqual "unmute removes the row" unmuted.next.domains (MuteBlock.Ready [ blocked ])
  assertEqual "unmute offers undo" (map _.undo unmuted.next.toast) (Just (Just (RestoreDomainMute "noisy.social")))
  let conflict = step (acknowledged.next) (Written fromDialog BlockDomain "example.social" (Left (Failure "REVISION_CONFLICT")))
  case conflict.next.dialog of
    Just (ConfirmBlock state) -> assertEqual "a conflict stays visible in the dialog" state.failure (Just (Failure "REVISION_CONFLICT"))
    _ -> throw "the dialog must stay open on failure"
  assertEqual "a failed write never changes the list" conflict.next.domains ready.domains
  let
    swapped = step (ready { writing = true }) (Written fromDialog ActorToMute "remote.example/users/zed" (Right (ActorRemoved "rel-1")))
  assertEqual "changing a block into a mute keeps its toast" (map _.rest swapped.next.toast) (Just " をミュートに変更しました")
  assertEqual "and refetches the individual list" swapped.effects 2
  -- Review round 2: the block waits for what it detaches; a failed lookup is retried, never skipped.
  let
    lookupFailed = detaching { dialog = Just (ConfirmBlock { domain: "example.social", current: Nothing, fromInput: true, impact: MuteBlock.Failed (Failure "UPSTREAM_UNAVAILABLE"), acknowledged: true, pending: false, failure: Nothing }) }
  assertEqual "no block is sent while the detached follows are unknown" (step lookupFailed ConfirmBlockDomain).effects 0
  let retried = step lookupFailed RetryImpact
  assertEqual "retry looks the follows up again" retried.effects 1
  case retried.next.dialog of
    Just (ConfirmBlock state) -> do
      assertEqual "retry is loading" state.impact MuteBlock.Loading
      assertEqual "retry clears the acknowledgement" state.acknowledged false
    _ -> throw "retry keeps the block confirmation"
  assertEqual "no block is sent while the lookup is loading" (step retried.next ConfirmBlockDomain).effects 0
  -- An undo (or row write) finishing while another dialog is open leaves that dialog and its input alone.
  let
    typing = AddDomain { input: "half-typed.exa", problem: Nothing, pending: false }
    undone = step (ready { writing = true, dialog = Just typing }) (Written row UndoWrite "noisy.social" (Right (DomainUpserted muted)))
  assertEqual "a finished undo keeps the open dialog" undone.next.dialog (Just typing)
  assertEqual "and does not move focus" undone.effects 0
  let
    withToast = unmuted.next { dialog = Just typing }
  assertEqual "undo cannot run behind an open dialog" (step withToast RunUndo).effects 0
  -- Review round 3: a write that completes after the Profile changed is dropped,
  -- even once the new Profile's list has arrived; its undo cannot write into B.
  let
    onB = (step (ready { writing = true }) (ProfileKnown (Right (Just "acc-2")))).next
    bControl = { domain: "only-b.example", mode: MUTE, revision: 1, createdAt: "2026-01-01T00:00:00Z" }
    bLoaded = (step onB (DomainsLoaded { profile: "acc-2", epoch: onB.epoch } (Right [ bControl ]))).next
    late = step bLoaded (Written row UnmuteDomainRow "noisy.social" (Right (DomainRemoved "noisy.social")))
  assertEqual "a switch starts a new epoch and frees the write flag" (Tuple onB.epoch onB.writing) (Tuple 1 false)
  assertEqual "a late write of A does not touch B's list" late.next.domains (MuteBlock.Ready [ bControl ])
  assertEqual "nor shows a toast (no undo into B)" late.next.toast Nothing
  assertEqual "nor runs anything" late.effects 0
  assertEqual "nothing to undo on B" (step late.next RunUndo).effects 0
  assertEqual "A's late list is dropped on B" (step bLoaded (DomainsLoaded { profile: "acc-1", epoch: 0 } (Right []))).next.domains (MuteBlock.Ready [ bControl ])
  let
    backOnA = (step bLoaded (ProfileKnown (Right (Just "acc-1")))).next
    lateOnA = step backOnA (Written row UnmuteDomainRow "noisy.social" (Right (DomainRemoved "noisy.social")))
  assertEqual "switching back to A does not revive the old completion" lateOnA.next.toast Nothing
  -- The undo belongs to the toast's owner.
  assertEqual "undo restores into the owner's Profile" (step unmuted.next RunUndo).effects 1
  assertEqual "undo of an earlier selection does nothing" (step (unmuted.next { epoch = 1 }) RunUndo).effects 0
  -- Round 3: one write at a time, and a completion closes only the dialog that sent it.
  let
    confirming = ConfirmMute { domain: "calm.example", current: Nothing, fromInput: true, pending: false, failure: Nothing }
    rowInFlight = ready { writing = true, dialog = Just confirming }
  assertEqual "a confirmation cannot send while another write is in flight" (step rowInFlight ConfirmMuteDomain).effects 0
  assertEqual "a row completion leaves the open confirmation alone"
    (step rowInFlight (Written row UnmuteDomainRow "noisy.social" (Right (DomainRemoved "noisy.social")))).next.dialog
    (Just confirming)
  let
    pendingDialog = ConfirmMute { domain: "calm.example", current: Nothing, fromInput: true, pending: true, failure: Nothing }
    lateRow = step (ready { writing = true, dialog = Just pendingDialog }) (Written row UnmuteDomainRow "noisy.social" (Left (Failure "UPSTREAM_UNAVAILABLE")))
  assertEqual "a row failure does not land in a pending dialog" lateRow.next.dialog (Just pendingDialog)
  let
    ownDone = step (ready { writing = true, dialog = Just pendingDialog }) (Written fromDialog MuteDomain "calm.example" (Right (DomainUpserted { domain: "calm.example", mode: MUTE, revision: 1, createdAt: "2026-01-01T00:00:00Z" })))
  assertEqual "the dialog's own completion closes it" ownDone.next.dialog Nothing

  -- Integration with quick reaction: its toast moves behind an open mute/block dialog and is inert.
  let
    reactionToast = { id: 1, kind: ReactionFailed "リアクションできませんでした" (NotImplemented "later"), holds: { hover: false, touch: false, focus: false }, armed: 1 }
    withToast dialog m = m
      { profileContext = Loaded { activeProfile: Nothing }
      , muteBlock = ready { dialog = dialog }
      , reaction = m.reaction { toast = Just reactionToast }
      }
  behind <- renderAfter (Just MuteBlockDomains) (withToast (Just (AddDomain { input: "keep-me.example", problem: Nothing, pending: false })))
  assertContains "reaction toast is behind the mute/block dialog" behind "sp-toast sp-toast-behind"
  free <- renderAfter (Just MuteBlockDomains) (withToast Nothing)
  assertNotContains "without a dialog the reaction toast is usable" free "sp-toast-behind"

testLoginHref :: Effect Unit
testLoginHref = do
  assertEqual "home returns to /" (loginHref (Just Home)) "/auth/login"
  assertEqual "unknown path returns to /" (loginHref Nothing) "/auth/login"
  assertEqual "login screen never returns to itself" (loginHref (Just (Login { error: Just "failed" }))) "/auth/login"
  assertEqual "settings" (loginHref (Just Settings)) "/auth/login?return_to=%2Fsettings"
  assertEqual "post detail" (loginHref (Just (PostDetail "post-1"))) "/auth/login?return_to=%2Fposts%2Fpost-1"

-- | What the client renders after the BFF answered (the same view as SSR, other model).
renderAfter :: Maybe Route -> (Model -> Model) -> Effect String
renderAfter route change = FRS.render (view (change ((initialModel route) { isHydrated = true, apiMode = Loaded REAL })))

testLoginScreens :: Effect Unit
testLoginScreens = do
  login <- renderPage "/login"
  assertContains "login SSR" login "data-testid=\"login-page\""
  assertContains "login SSR heading" login "ログイン"
  assertContains "login SSR start" login "href=\"/auth/login\""
  assertNotContains "login SSR has no reason" login "data-testid=\"login-error\""
  denied <- renderPage "/login?error=denied"
  assertContains "denied reason" denied "data-testid=\"login-error\" data-state=\"denied\""
  failed <- renderPage "/login?error=failed"
  assertContains "failed reason" failed "data-testid=\"login-error\" data-state=\"failed\""
  -- Only the reasons the BFF defines are shown; anything else in ?error= is ignored.
  forged <- renderPage "/login?error=%3Cb%3Eforged%3C%2Fb%3E"
  assertNotContains "forged reason" forged "data-testid=\"login-error\""
  assertNotContains "forged reason text" forged "forged</b>"
  -- Signed-out viewers: the header login entry and the notice return to this screen.
  signedOut <- renderAfter (Just (PostDetail "post-1")) (_ { profileContext = Failed (Unauthenticated "UNAUTHENTICATED") })
  assertContains "signed-out notice" signedOut "data-testid=\"auth-notice\" data-state=\"signed-out\""
  assertContains "login link returns here" signedOut "href=\"/auth/login?return_to=%2Fposts%2Fpost-1\""
  assertContains "header login link" signedOut "data-testid=\"login-link\""
  assertNotContains "no logout for signed-out" signedOut "ログアウト"
  expired <- renderAfter (Just Home) (_ { profileContext = Failed (SessionExpired "UNAUTHENTICATED") })
  assertContains "expired notice" expired "data-state=\"expired\""
  assertContains "expired header login link" expired "data-testid=\"login-link\""
  -- On /login the screen itself is the way in: no second notice.
  onLogin <- renderAfter (Just (Login { error: Nothing })) (_ { profileContext = Failed (SessionExpired "UNAUTHENTICATED") })
  assertNotContains "no notice on /login" onLogin "data-testid=\"auth-notice\""
  forbidden <- renderAfter (Just Home) (_ { profileContext = Failed (Forbidden "FORBIDDEN") })
  assertContains "forbidden notice" forbidden "data-state=\"forbidden\""
  assertContains "forbidden can log out" forbidden "ログアウト"
  assertNotContains "forbidden has no login link" forbidden "data-testid=\"login-link\""
  vanished <- renderAfter (Just Home) (_ { profileContext = Failed (ProfileUnavailable "PROFILE_UNAVAILABLE") })
  assertContains "profile-unavailable notice" vanished "data-state=\"profile-unavailable\""
  assertContains "profile-unavailable keeps the switcher" vanished "data-testid=\"profile-switcher\""
  assertContains "profile-unavailable asks to select" vanished "投稿用 Profile を選択"
  let
    profile = { id: "p1", handle: "alice", displayName: "Alice" }
  signedIn <- renderAfter (Just (Login { error: Nothing })) (_ { profileContext = Loaded { activeProfile: Just profile } })
  assertContains "signed-in login screen" signedIn "data-testid=\"login-state\" data-state=\"signed-in\""
  assertNotContains "signed-in login screen" signedIn "data-testid=\"login-start\""
  assertNotContains "signed-in has no notice" signedIn "data-testid=\"auth-notice\""

occurrences :: String -> String -> Int
occurrences needle haystack = length (split (Pattern needle) haystack) - 1

-- | Review follow-up: the expired reason on /login, no stale reason for a signed-in
-- | viewer, and exactly one focus target (authActionId) wherever the session state needs one.
testLoginFocusTargets :: Effect Unit
testLoginFocusTargets = do
  expired <- renderPage "/login?error=expired"
  assertContains "expired reason" expired "data-testid=\"login-error\" data-state=\"expired\""
  let
    profile = { id: "p1", handle: "alice", displayName: "Alice" }
    actionId = "id=\"" <> authActionId <> "\""
  staleDenied <- renderAfter (Just (Login { error: Just "denied" })) (_ { profileContext = Loaded { activeProfile: Just profile } })
  assertNotContains "signed-in viewer sees no stale reason" staleDenied "data-testid=\"login-error\""
  for_
    [ { label: "signed-out home", route: Just Home, context: Failed (Unauthenticated "U") }
    , { label: "expired home", route: Just Home, context: Failed (SessionExpired "U") }
    , { label: "forbidden home", route: Just Home, context: Failed (Forbidden "F") }
    , { label: "profile-unavailable home", route: Just Home, context: Failed (ProfileUnavailable "P") }
    , { label: "signed-out /login", route: Just (Login { error: Nothing }), context: Failed (Unauthenticated "U") }
    , { label: "expired /login", route: Just (Login { error: Nothing }), context: Failed (SessionExpired "U") }
    , { label: "forbidden /login", route: Just (Login { error: Nothing }), context: Failed (Forbidden "F") }
    , { label: "loading /login", route: Just (Login { error: Nothing }), context: Loading }
    ]
    \c -> do
      -- apiMode may still be loading when the Profile context fails.
      html <- FRS.render (view ((initialModel c.route) { isHydrated = true, profileContext = c.context }))
      assertEqual ("one focus target: " <> c.label) (occurrences actionId html) 1
      assertTrue ("authActionShown: " <> c.label) (authActionShown ((initialModel c.route) { profileContext = c.context }))
  signedIn <- renderAfter (Just Home) (_ { profileContext = Loaded { activeProfile: Just profile } })
  assertEqual "signed-in has no focus target" (occurrences actionId signedIn) 0
  -- Focus return of the Profile menu opened from the notice, at both widths.
  for_ [ false, true ] \isMobile -> do
    let
      width = if isMobile then "mobile" else "desktop"
      header = if isMobile then profileButtonMobileId else profileButtonDesktopId
      vanished = (initialModel (Just Home)) { isMobile = isMobile, profileContext = Failed (ProfileUnavailable "P") }
      resolved = vanished { profileContext = Loaded { activeProfile: Just profile } }
      onLogin = (initialModel (Just (Login { error: Nothing }))) { isMobile = isMobile, profileContext = Failed (Unauthenticated "U") }
    assertEqual ("cancel returns to the notice (" <> width <> ")") (visibleOpener vanished authActionId) authActionId
    assertEqual ("a chosen Profile returns to the header (" <> width <> ")") (visibleOpener resolved authActionId) header
    assertEqual ("header opener stays on the header (" <> width <> ")") (visibleOpener vanished profileButtonDesktopId) header
    assertTrue ("session lost on /login has a target (" <> width <> ")") (authActionShown onLogin)

-- | D08 second stage (ui-spec 3-x / 4-1 / 1-1 主導線, S8): the post screens' hidden /
-- | revealed states, the post menu and the 4-1 sheet.
testPostDisplay :: Effect Unit
testPostDisplay = do
  assertEqual "parse a person's page" (hush (parse routeCodec "/users/nana%40noisy.social")) (Just (UserProfile "nana@noisy.social"))
  roundTrip "route person" (UserProfile "nana@noisy.social")
  assertEqual "a person's page round-trips" (hush (parse routeCodec (print routeCodec (UserProfile "nana@noisy.social")))) (Just (UserProfile "nana@noisy.social"))
  userSsr <- renderPage "/users/nana%40noisy.social"
  assertContains "person SSR claims no data" userSsr "data-testid=\"user-page\" data-state=\"loading\""
  assertNotContains "person SSR shows no bio" userSsr "sp-user-bio"
  let
    profile = { id: "p1", handle: "alice", displayName: "Alice" }
    signedIn m = m { profileContext = Loaded { activeProfile: Just profile } }
    detailWith view replies m = (signedIn m) { detail = Loaded { view: Just view, replies } }
  -- 3-1: hidden first, kind + domain only; no tabs, no replies, nothing of the post.
  hidden <- renderAfter (Just (PostDetail "post-hidden")) (detailWith hiddenView [ visibleView ])
  assertContains "hidden card" hidden "data-testid=\"hidden-post\" data-mode=\"block\" data-domain=\"bot-farm.example\""
  assertContains "hidden title" hidden "ブロック中のドメインの投稿です"
  assertContains "reveal button" hidden "この投稿だけ表示"
  assertNotContains "no replies while hidden" hidden "sp-dtabs"
  assertNotContains "nothing of the post" hidden "hello"
  -- 3-2 / 3-3: revealed with its bar and [隠す]; a block keeps the operations locked.
  let
    revealedView = visibleView { id = "post-hidden" }
  revealed <- renderAfter (Just (PostDetail "post-hidden")) (\m -> (detailWith hiddenView [] m) { content = m.content { reveals = [ revealedView ] } })
  assertContains "revealed bar" revealed "data-testid=\"revealed-bar\" data-domain=\"bot-farm.example\""
  assertContains "hide button" revealed ">隠す</button>"
  assertContains "reply locked" revealed "data-locked=\"reply\""
  assertContains "locked label" revealed "返信（ブロック中）"
  assertNotContains "no reveal button any more" revealed "この投稿だけ表示"
  -- 3-5: replies of controlled domains fold into one row.
  folded <- renderAfter (Just (PostDetail "post-1")) (detailWith visibleView { operations = Nothing } [ visibleView, hiddenView ])
  assertContains "fold" folded "非表示の返信 1 件"
  assertContains "fold closed" folded "aria-expanded=\"false\""
  assertContains "hidden reply row" folded "ブロック中のドメインの返信"
  -- 3-4: a quote whose target stays hidden shows only kind and domain.
  quoted <- renderAfter (Just Home) (\m -> (signedIn m) { timeline = Loaded [ quotePost ] })
  assertContains "hidden quote target" quoted "data-state=\"hidden\" data-domain=\"noisy.social\""
  assertContains "hidden quote text" quoted "ミュート中のドメインの投稿"
  -- 1-1: the menu reflects the Profile's settings; this server's people get no domain items.
  let
    mbReady = MuteBlock.init { profile = Just "p1", profileKnown = true, domains = MuteBlock.Ready [ { domain: "misskey.example", mode: MUTE, revision: 2, createdAt: "" } ], actors = MuteBlock.Ready [] }
    menuOn m post = (signedIn m) { timeline = Loaded [ post ], muteBlock = mbReady, content = m.content { menu = Just { postId: post.id, opener: "sp-more-" <> post.id } } }
  remote <- renderAfter (Just Home) (\m -> menuOn m samplePost)
  assertContains "menu" remote "data-testid=\"post-menu\""
  assertContains "person mute" remote "@mika をミュート"
  assertContains "domain unmute (already muted)" remote " のミュートを解除"
  assertContains "domain block" remote " をブロック"
  local <- renderAfter (Just Home) (\m -> menuOn m samplePost { id = "post-local", author = samplePost.author { local = true, domain = "shuttlepub.example" } })
  assertNotContains "no domain items for this server" local "shuttlepub.example</span> を"

  -- The mute/block actions behind the menu and the 4-1 sheet.
  let
    muted = { domain: "noisy.social", mode: MUTE, revision: 3, createdAt: "" }
    blocked = { domain: "bot-farm.example", mode: BLOCK, revision: 4, createdAt: "" }
    ready = MuteBlock.init { profile = Just "p1", profileKnown = true, domains = MuteBlock.Ready [ muted, blocked ], actors = MuteBlock.Ready [] }
    step model message = case MuteBlockUpdate.update model message of
      Tuple next effects -> { next, effects: length effects }
    row = { profile: "p1", epoch: 0, dialog: false }
  assertEqual "menu mute writes at once" (step ready (MenuMuteDomain "misskey.example")).effects 1
  let
    quick = step (ready { writing = true }) (Written row QuickMuteDomain "misskey.example" (Right (DomainUpserted { domain: "misskey.example", mode: MUTE, revision: 1, createdAt: "" })))
  assertEqual "menu mute offers 元に戻す" (map _.undo quick.next.toast) (Just (Just (RemoveDomainMute "misskey.example")))
  assertEqual "元に戻す removes the new mute" (step quick.next RunUndo).effects 1
  assertEqual "menu unmute uses the listed revision" (step ready (MenuUnmuteDomain "noisy.social")).effects 1
  let sheet = step ready (OpenBlockedSheet "sp-locked-reply-x" "返信" "bot-farm.example" 4)
  assertEqual "4-1 sheet" sheet.next.dialog (Just (BlockedSheet { action: "返信", domain: "bot-farm.example", revision: 4 }))
  assertEqual "4-1 remembers its opener" sheet.next.opener (Just "sp-locked-reply-x")
  case (step sheet.next SheetUnblock).next.dialog of
    Just (ConfirmDomainUnblock state) -> assertEqual "ブロックを解除… opens the settings' unblock dialog" state.control blocked
    _ -> throw "expected the unblock dialog"
  let actorBlock = step ready (MenuBlockActor "sp-more-x" "https://misskey.example/users/mika" "@mika")
  assertEqual "a person's block looks up what it detaches" actorBlock.effects 2
  assertEqual "and cannot be confirmed before" (step actorBlock.next ConfirmActorBlockNow).effects 0
  let
    impactKnown = step actorBlock.next (ActorImpactLoaded { profile: "p1", epoch: 0 } "https://misskey.example/users/mika" (Right { following: [], followers: [] }))
  assertEqual "nothing detached: block is one write" (step impactKnown.next ConfirmActorBlockNow).effects 1

  -- Content state in the app update: reveals are page-local and per Profile.
  let
    update = mkUpdate (unsafeCoerce unit)
    run model message = case update model message of
      Tuple next effects -> { next, effects: length effects }
    onDetail = (signedIn (initialModel (Just (PostDetail "post-hidden")))) { isHydrated = true, detail = Loaded { view: Just hiddenView, replies: [] } }
    shown = onDetail { content = onDetail.content { profile = Just "p1", epoch = 4 } }
    asked = run shown (App.RevealPost "post-hidden")
  assertEqual "reveal asks once" asked.effects 1
  assertEqual "a second press while pending does nothing" (run asked.next (App.RevealPost "post-hidden")).effects 0
  let request = asked.next.content.revealSeq
  assertEqual "an answer to another request is dropped" (run asked.next (App.PostRevealed "post-hidden" (request - 1) (Right (Just revealedView)))).next.content.reveals []
  let got = run asked.next (App.PostRevealed "post-hidden" request (Right (Just revealedView)))
  assertEqual "the reveal is kept for this page" (map _.id got.next.content.reveals) [ "post-hidden" ]
  assertEqual "[隠す] drops it" (run got.next (App.HidePost "post-hidden")).next.content.reveals []
  -- Review: [隠す] before a late answer (e.g. the reveal asked again after a setting
  -- changed) wins; the late answer does not show the post again.
  let hiddenWhileAsking = run asked.next (App.HidePost "post-hidden")
  assertEqual "a reveal answered after [隠す] stays hidden"
    (run hiddenWhileAsking.next (App.PostRevealed "post-hidden" request (Right (Just revealedView)))).next.content.reveals
    []
  let
    refreshed = run (got.next { muteBlock = ready, content = got.next.content { controlsSeen = Just [ { domain: "other.example", mode: MUTE, revision: 1, createdAt: "" } ] } })
      (App.MuteBlockMsg (DomainsLoaded { profile: "p1", epoch: 0 } (Right [ muted, blocked ])))
    reRequest = refreshed.next.content.revealSeq
  assertEqual "a changed setting asks for the page's reveal again" (map _.id refreshed.next.content.revealing) [ "post-hidden" ]
  -- Review 2: the reveal made under the old controls (its operations included) is not
  -- used while it is asked again; a failed or empty answer leaves the post hidden with
  -- the error and the reveal button to retry (3-3).
  assertEqual "the old reveal is dropped while it is asked again" refreshed.next.content.reveals []
  pendingHtml <- renderAfter (Just (PostDetail "post-hidden")) (const refreshed.next)
  assertNotContains "no revealed post (nor its operations) while asking" pendingHtml "data-testid=\"revealed-post\""
  assertContains "the post is hidden and pending meanwhile" pendingHtml "id=\"sp-reveal-post-hidden\" disabled=\"disabled\""
  let refreshFailed = run refreshed.next (App.PostRevealed "post-hidden" reRequest (Left (NotImplemented "down")))
  assertEqual "a failed re-reveal leaves the post hidden" refreshFailed.next.content.reveals []
  assertEqual "with its error" (map _.id refreshFailed.next.content.revealError) (Just "post-hidden")
  failedHtml <- renderAfter (Just (PostDetail "post-hidden")) (const refreshFailed.next)
  assertContains "the error is shown on the hidden post" failedHtml "data-error=\"not_implemented\""
  assertNotContains "and its reveal button can retry" failedHtml "id=\"sp-reveal-post-hidden\" disabled=\"disabled\""
  assertEqual "a retry asks again" (run refreshFailed.next (App.RevealPost "post-hidden")).effects 1
  let refreshGone = run refreshed.next (App.PostRevealed "post-hidden" reRequest (Right Nothing))
  assertEqual "a post gone on re-reveal is hidden too" (Tuple refreshGone.next.content.reveals (map _.id refreshGone.next.content.revealError)) (Tuple [] (Just "post-hidden"))
  assertEqual "a re-reveal brings the post back" (map _.id (run refreshed.next (App.PostRevealed "post-hidden" reRequest (Right (Just revealedView)))).next.content.reveals) [ "post-hidden" ]
  let hiddenDuringRefresh = run refreshed.next (App.HidePost "post-hidden")
  assertEqual "[隠す] during that re-reveal wins over its late answer"
    (run hiddenDuringRefresh.next (App.PostRevealed "post-hidden" reRequest (Right (Just revealedView)))).next.content.reveals
    []
  -- The same for a person's posts (3-6).
  let
    page = { author: samplePost.author, bio: "bio", control: Just { mode: BLOCK, domain: "bot-farm.example", revision: 2 }, hidden: Just { mode: BLOCK, domain: "bot-farm.example", revision: 2 }, posts: [] }
    onUser = (signedIn (initialModel (Just (UserProfile "mika@misskey.example")))) { isHydrated = true }
    userShown = onUser { content = onUser.content { profile = Just "p1", user = Loaded (Just page) } }
    userAsked = run userShown App.RevealUserPosts
    userRequest = userAsked.next.content.revealSeq
    userHidden = run userAsked.next App.HideUserPosts
  assertEqual "posts revealed after [隠す] stay hidden"
    (run userHidden.next (App.UserPostsRevealed "mika@misskey.example" userRequest (Right (Just page { hidden = Nothing })))).next.content.userRevealed
    Nothing
  let userGot = run userAsked.next (App.UserPostsRevealed "mika@misskey.example" userRequest (Right (Just page { hidden = Nothing })))
  assertTrue "the person's own reveal is applied" (isJust userGot.next.content.userRevealed)
  let
    userRefreshed = run (userGot.next { muteBlock = ready, content = userGot.next.content { controlsSeen = Just [ { domain: "other.example", mode: MUTE, revision: 1, createdAt: "" } ] } })
      (App.MuteBlockMsg (DomainsLoaded { profile: "p1", epoch: 0 } (Right [ muted, blocked ])))
    userReRequest = userRefreshed.next.content.revealSeq
  assertEqual "a person's revealed posts are asked again, not kept meanwhile"
    (Tuple (isJust userRefreshed.next.content.userRevealed) userRefreshed.next.content.userRevealing)
    (Tuple false (Just userReRequest))
  userPendingHtml <- renderAfter (Just (UserProfile "mika@misskey.example")) (const userRefreshed.next)
  assertNotContains "no revealed posts while asking" userPendingHtml "data-testid=\"revealed-posts\""
  assertContains "the posts are hidden and pending meanwhile" userPendingHtml "id=\"sp-reveal-user\" disabled=\"disabled\""
  let userFailed = run userRefreshed.next (App.UserPostsRevealed "mika@misskey.example" userReRequest (Left (NotImplemented "down")))
  assertEqual "a failed re-reveal leaves the posts hidden, with the error"
    (Tuple (isJust userFailed.next.content.userRevealed) userFailed.next.content.userRevealError)
    (Tuple false (Just (NotImplemented "down")))
  userFailedHtml <- renderAfter (Just (UserProfile "mika@misskey.example")) (const userFailed.next)
  assertContains "shown on the hidden posts" userFailedHtml "data-error=\"not_implemented\""
  assertNotContains "whose button can retry" userFailedHtml "id=\"sp-reveal-user\" disabled=\"disabled\""
  assertEqual "a person gone on re-reveal is hidden too"
    (isJust (run userRefreshed.next (App.UserPostsRevealed "mika@misskey.example" userReRequest (Right Nothing))).next.content.userRevealed)
    false
  assertEqual "a retry asks again" (run userFailed.next App.RevealUserPosts).effects 1
  let switched = run got.next (App.ProfileContextLoaded (Right { activeProfile: Just profile { id = "p2" } }))
  assertEqual "another Profile starts from hidden again" switched.next.content.reveals []
  assertTrue "and asks for its own content" (switched.next.content.epoch > 4 && switched.next.content.profile == Just "p2")
  let
    onHome = (signedIn (initialModel (Just Home))) { isHydrated = true, timeline = Loaded [ samplePost ], muteBlock = ready, content = (initialModel Nothing).content { profile = Just "p1", epoch = 2, controlsSeen = Just [ muted, blocked ] } }
    wrote = run (onHome { muteBlock = ready { writing = true } }) (App.MuteBlockMsg (Written row QuickMuteDomain "misskey.example" (Right (DomainUpserted { domain: "misskey.example", mode: MUTE, revision: 1, createdAt: "" }))))
  assertEqual "a written domain control asks for the timeline again" wrote.next.content.epoch 3
  -- Review: a reload of the settings after a 409 (Loading -> Ready, changed in another tab)
  -- also asks the content again; the first list of a Profile only becomes the reference.
  let
    seen = onHome { content = onHome.content { controlsSeen = Just [ muted, blocked ] }, muteBlock = ready { domains = MuteBlock.Loading } }
    otherTab = { domain: "misskey.example", mode: MUTE, revision: 1, createdAt: "" }
    recovered = run seen (App.MuteBlockMsg (DomainsLoaded { profile: "p1", epoch: 0 } (Right [ muted, blocked, otherTab ])))
  assertEqual "a recovered, changed list asks for the timeline again" recovered.next.content.epoch 3
  let unchanged = run seen (App.MuteBlockMsg (DomainsLoaded { profile: "p1", epoch: 0 } (Right [ muted, blocked ])))
  assertEqual "an unchanged list does not" unchanged.next.content.epoch 2
  let first = run (onHome { muteBlock = ready { domains = MuteBlock.Loading }, content = onHome.content { controlsSeen = Nothing } }) (App.MuteBlockMsg (DomainsLoaded { profile: "p1", epoch: 0 } (Right [ muted ])))
  assertEqual "the first list is only the reference" (Tuple first.next.content.epoch first.next.content.controlsSeen) (Tuple 2 (Just [ muted ]))
  -- Mock mode says the hiding is a preview, where posts are shown; real mode has none.
  mockHome <- renderAfter (Just Home) (\m -> (signedIn m) { apiMode = Loaded MOCK, timeline = Loaded [ samplePost ] })
  assertContains "preview note on the timeline" mockHome "data-testid=\"content-preview-note\""
  realHome <- renderAfter (Just Home) (\m -> (signedIn m) { timeline = Failed (NotImplemented "no endpoint") })
  assertNotContains "no preview note in real mode" realHome "content-preview-note"
  -- 3-6: a hidden post in a person's list is a hidden card of its own (not an empty slot).
  listed <- renderAfter (Just (UserProfile "ken@other.example")) (\m -> (signedIn m) { content = m.content { user = Loaded (Just page { control = Nothing, hidden = Nothing, posts = [ hiddenView, visibleView ] }) } })
  assertContains "a hidden post in the list" listed "data-testid=\"hidden-post\" data-mode=\"block\" data-domain=\"bot-farm.example\""
  assertContains "with its own reveal" listed "id=\"sp-reveal-post-hidden\""
