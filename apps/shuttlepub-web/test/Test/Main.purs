module Test.Main where

import Prelude

import App.Api.Error (ApiError(..), describe, fromGqlCode, tag)
import App.Model (Model, RemoteData(..), fromEither, initialModel)
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
  assertEqual "parse / is Home" (hush (parse routeCodec "/")) (Just Home)
  assertEqual "print Home" (print routeCodec Home) "/"
  assertEqual "parse unknown path" (hush (parse routeCodec "/nope")) Nothing
  roundTrip "route Home" Home

testModelRoundTrip :: Effect Unit
testModelRoundTrip = do
  roundTrip "initial model" (initialModel (Just Home))
  roundTrip "initial model (unknown route)" (initialModel Nothing)
  let
    loaded :: Model
    loaded =
      { route: Just Home
      , isHydrated: true
      , apiMode: Loaded MOCK
      , apiStatus: Loaded { apiVersion: "v1" }
      , profileContext: Loaded { activeProfile: Just { id: "p1", handle: "alice", displayName: "Alice" } }
      }

    loading :: Model
    loading = (initialModel (Just Home)) { apiStatus = Loading }

    failed :: Model
    failed =
      { route: Just Home
      , isHydrated: true
      , apiMode: Loaded REAL
      , apiStatus: Failed (NotImplemented "later")
      , profileContext: Failed (Unavailable "down")
      }
  roundTrip "loaded model" loaded
  roundTrip "failed model" failed
  roundTrip "loading model" loading

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

testSsr :: Effect Unit
testSsr = do
  home <- renderPage "/"
  assertContains "home SSR" home "<h1>ShuttlePub</h1>"
  assertContains "home SSR" home "data-testid=\"hydration-state\""
  assertContains "home SSR" home "template-state"
  assertContains "home SSR" home "id=\"app\""
  assertContains "home SSR claims no data" home "API status: Loading"
  assertNotContains "home SSR" home "not-found"
  missing <- renderPage "/nope"
  assertContains "unknown path SSR" missing "404"
  assertNotContains "unknown path SSR" missing "API status"
  for_ [ "/", "/nope" ] \path -> do
    html <- renderPage path
    assertNotContains ("SSR " <> path) html "undefined"
