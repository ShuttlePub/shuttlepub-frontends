module Test.Main where

import Prelude

import App.Api.Error (ApiError(..), describe, fromGqlCode, tag)
import App.Model (Model, RemoteData(..), fromEither, initialModel)
import App.Model as AppModel
import App.MuteBlock.Types as MuteBlock
import App.MuteBlock.Types (Change(..), Dialog(..), Failure(..), InputProblem(..), Message(..), Undo(..), Write(..))
import App.MuteBlock.Update as MuteBlockUpdate
import Data.Array (length)
import Data.Tuple (Tuple(..))
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))
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
  testMuteBlock

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
  assertEqual "parse mute-block domains" (hush (parse routeCodec "/settings/mute-block/domains")) (Just MuteBlockDomains)
  assertEqual "parse mute-block accounts" (hush (parse routeCodec "/settings/mute-block/accounts")) (Just MuteBlockAccounts)
  assertEqual "print mute-block domains" (print routeCodec MuteBlockDomains) "/settings/mute-block/domains"
  assertEqual "mute-block root is not a page" (hush (parse routeCodec "/settings/mute-block")) Nothing

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
      , muteBlock: MuteBlock.init
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
      , muteBlock: MuteBlock.init
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
  roundTrip "mute-block model" (ready { dialog = Just (ConfirmBlock { domain: "example.social", current: Nothing, fromInput: true, impact: MuteBlock.Ready { following: [ "https://example.social/users/a" ], followers: [] }, acknowledged: false, pending: false, failure: Nothing }) })
  roundTrip "app model with mute-block" ((initialModel (Just MuteBlockDomains)) { muteBlock = ready } :: AppModel.Model)
  let none = step MuteBlock.init (ProfileKnown (Right Nothing))
  assertEqual "no profile is an error, not an empty list" none.next.domains (MuteBlock.Failed (Failure "PROFILE_REQUIRED"))
  let known = step MuteBlock.init (ProfileKnown (Right (Just "acc-1")))
  assertEqual "a known profile loads both lists" known.effects 2
  assertEqual "stale list response is dropped" (step ready (DomainsLoaded "acc-2" (Right []))).next.domains ready.domains
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
  let unmuted = step (ready { writing = true }) (Written UnmuteDomainRow "noisy.social" (Right (DomainRemoved "noisy.social")))
  assertEqual "unmute removes the row" unmuted.next.domains (MuteBlock.Ready [ blocked ])
  assertEqual "unmute offers undo" (map _.undo unmuted.next.toast) (Just (Just (RestoreDomainMute "noisy.social")))
  let conflict = step (acknowledged.next) (Written BlockDomain "example.social" (Left (Failure "REVISION_CONFLICT")))
  case conflict.next.dialog of
    Just (ConfirmBlock state) -> assertEqual "a conflict stays visible in the dialog" state.failure (Just (Failure "REVISION_CONFLICT"))
    _ -> throw "the dialog must stay open on failure"
  assertEqual "a failed write never changes the list" conflict.next.domains ready.domains
  let
    swapped = step (ready { writing = true }) (Written ActorToMute "remote.example/users/zed" (Right (ActorRemoved "rel-1")))
  assertEqual "changing a block into a mute keeps its toast" (map _.rest swapped.next.toast) (Just " をミュートに変更しました")
  assertEqual "and refetches the individual list" swapped.effects 2
