module Test.Main where

import Prelude

import App.Api.Error (ApiError(..), describe, fromGqlCode, isSignedOut, tag, withReason)
import App.Dom (fullDateTime, relativeTime)
import App.Model (DetailTab(..), Model, RemoteData(..), emptyCompose, fromEither, initialModel)
import App.Post (Post, TimelineTab(..), Visibility(..), allTimelineTabs, timelineTabFromValue, timelineTabValue)
import App.Route (Route(..), routeCodec)
import App.View (view)
import App.View.Auth (authActionId, authActionShown)
import App.View.Common (loginHref)
import App.View.Shell (profileButtonDesktopId, profileButtonMobileId)
import Client.Update (visibleOpener)
import Data.Array (length)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Either (Either(..), hush)
import Data.Foldable (for_)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains, split)
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
  testReaction
  testLoginHref
  testLoginScreens
  testLoginFocusTargets

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

samplePost :: Post
samplePost =
  { id: "post-1"
  , noteId: "5f0c1a2e-7b3d-4e21-9c55-000000000001"
  , author: { id: "author-1", handle: "mika@misskey.example", displayName: "Mika" }
  , text: "hello\nworld"
  , createdAt: "2026-01-15T11:55:00.000Z"
  , replyCount: 0
  , repostCount: 1
  , repostedBy: Just { id: "author-2", handle: "ren@shuttlepub.example", displayName: "Ren" }
  , inReplyToId: Nothing
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
      , detail = Loaded { post: Just samplePost, replies: [ samplePost ] }
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
  assertContains "detail SSR heading" detail "<h1>投稿</h1>"
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
