module Test.Main where

import Prelude

import App.Api.Error (ApiError(..), describe, fromGqlCode, tag)
import App.Dom (fullDateTime, relativeTime)
import App.Model (DetailTab(..), Model, RemoteData(..), emptyCompose, fromEither, initialModel)
import App.Post (Post, TimelineTab(..), Visibility(..), allTimelineTabs, timelineTabFromValue, timelineTabValue)
import App.Route (Route(..), routeCodec)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Either (Either(..), hush)
import Data.Foldable (for_)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))
import Routing.Duplex (parse, print)
import Server (renderPage)

main :: Effect Unit
main = do
  log "shuttlepub-web tests"
  testRouteCodec
  testModelRoundTrip
  testErrorMapping
  testTimelineTabs
  testTimeFormatting
  testSsr

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
  for_ [ "/", "/posts/post-sora-zine", "/settings", "/notifications", "/search", "/bookmarks", "/nope" ] \path -> do
    html <- renderPage path
    assertContains ("SSR " <> path) html "data-testid=\"app-shell\""
    assertNotContains ("SSR " <> path) html "undefined"
