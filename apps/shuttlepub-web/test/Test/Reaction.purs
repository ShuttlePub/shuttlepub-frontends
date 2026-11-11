-- | Quick reaction (D03) rules and state transitions (Client.Reaction.update), checked
-- | on the model. Effects (requests, focus, timers) are not run here; their outcome
-- | messages are fed back by hand, as the runtime would.
module Test.Reaction (testReaction) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Emoji (Emoji, EmojiKind(..), emojiKey, unicode)
import App.Model (Model, RemoteData(..), initialModel)
import App.Reaction (DetailFilter(..), PickerTarget(..), PostReactions, ReactionMsg(..), ToastKind(..), chipsOf, moveItem, reactorRows, totalCount)
import App.Route (Route(..))
import Client.Reaction as QR
import Data.Argonaut.Decode (decodeJson)
import Data.Argonaut.Encode (encodeJson)
import Data.Array (length)
import Data.Array as Array
import Data.Either (Either(..), hush)
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Tuple (Tuple(..), fst)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual label actual expected =
  unless (actual == expected) (throw (label <> " - expected " <> show expected <> ", got " <> show actual))

assertTrue :: String -> Boolean -> Effect Unit
assertTrue label ok = assertEqual label ok true

party :: Emoji
party = unicode "🎉"

thumbs :: Emoji
thumbs = unicode "👍"

oldBlob :: Emoji
oldBlob = { kind: CustomEmoji, value: "old_blob", shortcode: Just "old_blob", imageUrl: Nothing, available: false, unavailableReason: Nothing }

sora :: { postId :: String, noteId :: String }
sora = { postId: "post-sora-zine", noteId: "note-sora" }

mika :: { postId :: String, noteId :: String }
mika = { postId: "post-mika-picker", noteId: "note-mika" }

me :: { id :: String, handle :: String, displayName :: String }
me = { id: "profile-fixture-1", handle: "fixture", displayName: "Fixture Profile" }

other :: { id :: String, handle :: String, displayName :: String }
other = { id: "profile-fixture-2", handle: "fixture_dev", displayName: "Fixture Dev" }

reactions :: Array PostReactions
reactions =
  [ { noteId: sora.noteId, mine: Just party, others: [ { emoji: party, count: 4, reactors: [] }, { emoji: unicode "✨", count: 2, reactors: [] } ] }
  , { noteId: mika.noteId, mine: Nothing, others: [ { emoji: thumbs, count: 3, reactors: [] } ] }
  ]

-- | Fixture Profile acting, its reactions and favourites loaded, on the home timeline.
ready :: Model
ready =
  let
    base = (initialModel (Just Home)) { isHydrated = true, profileContext = Loaded { activeProfile: Just me } }
    Tuple synced _ = QR.syncProfile base
  in
    synced
      { reaction = synced.reaction
          { posts = reactions
          , settings = Loaded { profileId: me.id, revision: 3, favorites: [ thumbs, party, oldBlob ] }
          }
      }

step :: Model -> ReactionMsg -> Model
step model message = fst (QR.update model message)

mineOn :: Model -> String -> Maybe Emoji
mineOn model noteId = Array.find (\entry -> entry.noteId == noteId) model.reaction.posts >>= _.mine

testReaction :: Effect Unit
testReaction = do
  log "  quick reaction"
  testRules
  testReactAndRemove
  testUndoClosesPicker
  testDoubleSubmitAndFailure
  testUnavailable
  testProfileSwitch
  testSettings
  testDetailFilter
  testNavigationConfirmsRemoval

testRules :: Effect Unit
testRules = do
  let
    chips = chipsOf (Just me) { noteId: "n", mine: Just (unicode "🦀"), others: [ { emoji: thumbs, count: 5, reactors: [] }, { emoji: party, count: 2, reactors: [] } ] }
  -- 注意 4: my chip is first even when nobody else used that emoji.
  assertEqual "my chip first" (map (\chip -> Tuple (emojiKey chip.emoji) chip.count) chips) [ Tuple "u:🦀" 1, Tuple "u:👍" 5, Tuple "u:🎉" 2 ]
  assertTrue "my chip is mine" (map _.mine (Array.head chips) == Just true)
  let
    merged = chipsOf (Just me) { noteId: "n", mine: Just party, others: [ { emoji: thumbs, count: 5, reactors: [] }, { emoji: party, count: 2, reactors: [ other ] } ] }
  assertEqual "my emoji merges into its group" (map (\chip -> Tuple (emojiKey chip.emoji) chip.count) merged) [ Tuple "u:🎉" 3, Tuple "u:👍" 5 ]
  assertEqual "total counts mine once" (totalCount { noteId: "n", mine: Just party, others: [ { emoji: party, count: 2, reactors: [] } ] }) 3
  let
    sample = { noteId: "n", mine: Just party, others: [ { emoji: thumbs, count: 1, reactors: [ other ] } ] }
  -- D3: me first with 「あなた」.
  assertEqual "reactors: me first" (map (\row -> Tuple row.reactor.id row.you) (reactorRows (Just me) AllReactors sample)) [ Tuple me.id true, Tuple other.id false ]
  assertEqual "reactors: one emoji" (map _.reactor.id (reactorRows (Just me) (OnlyEmoji "u:👍") sample)) [ other.id ]
  assertEqual "reactors: closed" (length (reactorRows (Just me) ListClosed sample)) 0
  assertEqual "move left" (moveItem 2 1 [ "a", "b", "c" ]) [ "a", "c", "b" ]
  assertEqual "move by drag" (moveItem 0 2 [ "a", "b", "c" ]) [ "b", "c", "a" ]

testReactAndRemove :: Effect Unit
testReactAndRemove = do
  -- Not reacted: the picker opens; picking reacts (optimistic) and closes the picker.
  let
    opened = step ready (OpenPicker (ReactTo mika) "react-post-mika-picker")
  assertTrue "picker open" (isJust opened.reaction.picker)
  let
    picked = step opened (Pick thumbs)
  assertEqual "picked" (mineOn picked mika.noteId) (Just thumbs)
  assertTrue "picker closed after picking" (isNothing picked.reaction.picker)
  assertTrue "request in flight" (Array.elem mika.noteId picked.reaction.inFlight)
  let
    saved = step picked (ReactionSaved me.id mika Nothing (Right (Just thumbs)))
  assertTrue "settled" (not (Array.elem mika.noteId saved.reaction.inFlight))
  -- Reacted: no picker (no replacement from the picker); my chip removes it.
  assertTrue "no picker while reacted" (isNothing (step saved (OpenPicker (ReactTo mika) "x")).reaction.picker)
  assertEqual "someone's chip does nothing while reacted" (mineOn (step saved (ReactWithChip mika party)) mika.noteId) (Just thumbs)
  let
    removed = step saved (RemoveMine mika)
  assertEqual "removed on screen" (mineOn removed mika.noteId) Nothing
  assertTrue "removal pending (not sent yet)" (map _.post.noteId removed.reaction.pendingRemoval == Just mika.noteId)
  assertTrue "undo toast"
    ( case removed.reaction.toast of
        Just { kind: UndoRemoval _ } -> true
        _ -> false
    )
  -- The picker is offered again; C3: someone's chip reacts while not reacted.
  assertTrue "picker again after removal" (isJust (step removed (OpenPicker (ReactTo mika) "x")).reaction.picker)
  let
    viaChip = step removed (ReactWithChip mika party)
  assertEqual "reacted with someone's chip" (mineOn viaChip mika.noteId) (Just party)
  assertTrue "re-reacting cancels the unsent removal" (isNothing viaChip.reaction.pendingRemoval)
  -- The toast going away sends the removal (D03 q09).
  case removed.reaction.toast of
    Just toast -> do
      let
        Tuple expired effects = QR.update removed (ToastExpired toast.id toast.armed)
      assertTrue "toast gone" (isNothing expired.reaction.toast)
      assertTrue "removal no longer pending" (isNothing expired.reaction.pendingRemoval)
      assertTrue "removal sent" (length effects >= 1)
      -- While hovered the toast stays (注意 3).
      let
        held = step removed (ToastHold true)
      assertTrue "held toast stays" (isJust (step held (ToastExpired toast.id toast.armed)).reaction.toast)
      let
        released = step held (ToastHold false)
      assertTrue "released toast restarts its timer" (map _.armed released.reaction.toast /= Just toast.armed)
    Nothing -> throw "expected a toast"

-- | 実装上の注意 1: undo while a picker is open closes it and restores the reaction.
testUndoClosesPicker :: Effect Unit
testUndoClosesPicker = do
  let
    removed = step ready (RemoveMine sora)
    reopened = step removed (OpenPicker (ReactTo sora) "react-post-sora-zine")
  assertTrue "picker reopened on the same post" (isJust reopened.reaction.picker)
  let
    undone = step reopened ToastUndo
  assertTrue "picker closed by undo" (isNothing undone.reaction.picker)
  assertEqual "reaction restored (not replaced)" (mineOn undone sora.noteId) (Just party)
  assertTrue "nothing to send after undo" (isNothing undone.reaction.pendingRemoval)
  assertTrue "toast gone after undo" (isNothing undone.reaction.toast)
  -- Undo after the toast went away does nothing.
  case removed.reaction.toast of
    Just toast -> assertEqual "late undo" (mineOn (step (step removed (ToastExpired toast.id toast.armed)) ToastUndo) sora.noteId) Nothing
    Nothing -> throw "expected a toast"

testDoubleSubmitAndFailure :: Effect Unit
testDoubleSubmitAndFailure = do
  let
    first = step ready (ReactWithChip mika thumbs)
    second = step first (ReactWithChip mika party)
  assertEqual "second submit ignored" (mineOn second mika.noteId) (Just thumbs)
  assertEqual "one request in flight" (Array.length (Array.filter (_ == mika.noteId) second.reaction.inFlight)) 1
  assertTrue "removal ignored while in flight" (isNothing (step first (RemoveMine mika)).reaction.pendingRemoval)
  let
    failed = step first (ReactionSaved me.id mika Nothing (Left (NotImplemented "501")))
  assertEqual "failure reverts" (mineOn failed mika.noteId) Nothing
  assertTrue "failure shown"
    ( case failed.reaction.toast of
        Just { kind: ReactionFailed _ (NotImplemented _) } -> true
        _ -> false
    )
  -- A removal that fails is shown and the reaction comes back.
  let
    removed = step ready (RemoveMine sora)
  case removed.reaction.pendingRemoval of
    Just removal -> do
      let
        refused = step (step removed (ToastExpired 1 1)) (RemovalSent removal (Left (UpstreamError "500")))
      assertEqual "failed removal restores" (mineOn refused sora.noteId) (Just party)
    Nothing -> throw "expected a pending removal"

testUnavailable :: Effect Unit
testUnavailable = do
  -- An unavailable emoji is never sent (P2 / D03 q05)...
  let
    opened = step ready (OpenPicker (ReactTo mika) "x")
  assertEqual "unavailable not picked" (mineOn (step opened (Pick oldBlob)) mika.noteId) Nothing
  assertTrue "explains instead"
    ( case (step opened (PickUnavailableFavorite oldBlob)).reaction.toast of
        Just { kind: FavoriteUnavailable _ } -> true
        _ -> false
    )
  assertTrue "picker stays open" (isJust (step opened (PickUnavailableFavorite oldBlob)).reaction.picker)
  -- ...but a selected reaction that became unavailable can be removed.
  let
    withOld = ready { reaction = ready.reaction { posts = [ { noteId: sora.noteId, mine: Just oldBlob, others: [] } ] } }
  assertEqual "unavailable reaction removable" (mineOn (step withOld (RemoveMine sora)) sora.noteId) Nothing

testProfileSwitch :: Effect Unit
testProfileSwitch = do
  let
    busy = step (step ready (OpenPicker (ReactTo mika) "x")) (RemoveMine sora)
    switched = fst (QR.syncProfile (busy { profileContext = Loaded { activeProfile: Just other } }))
  assertEqual "new acting Profile" switched.reaction.profileId (Just other.id)
  assertEqual "reactions of the previous Profile dropped" (length switched.reaction.posts) 0
  assertTrue "settings reloading" (switched.reaction.settings == Loading)
  assertTrue "picker closed" (isNothing switched.reaction.picker)
  assertTrue "toast dropped" (isNothing switched.reaction.toast)
  assertTrue "pending removal sent (not kept)" (isNothing switched.reaction.pendingRemoval)
  -- Late answers for the previous Profile are not mixed in.
  let
    late = step switched (PostReactionsLoaded me.id (Right reactions))
  assertEqual "late reactions ignored" (length late.reaction.posts) 0
  assertTrue "late settings ignored" ((step switched (SettingsLoaded me.id (Right { profileId: me.id, revision: 3, favorites: [ thumbs ] }))).reaction.settings == Loading)
  let
    same = fst (QR.syncProfile ready)
  assertEqual "same Profile keeps state" (length same.reaction.posts) (length reactions)

testSettings :: Effect Unit
testSettings = do
  let
    added = step (step ready (OpenPicker AddFavorite "sp-fav-add")) (Pick (unicode "🙏"))
  assertEqual "added at the end" (favorites added) [ "u:👍", "u:🎉", "c:old_blob", "u:🙏" ]
  assertTrue "saving" added.reaction.savingSettings
  assertTrue "no second save while saving" (favorites (step added (RemoveFavorite 0)) == favorites added)
  -- 409: show the stored list and offer to send ours again.
  let
    previous = { profileId: me.id, revision: 3, favorites: [ thumbs, party, oldBlob ] }
    intended = [ thumbs, party, oldBlob, unicode "🙏" ]
    conflicted = step added (SettingsSaved me.id previous intended (Left (RevisionConflict "stale")))
  assertEqual "conflict shows the stored list" (favorites conflicted) [ "u:👍", "u:🎉", "c:old_blob" ]
  assertTrue "conflict offers a retry" (map (map (map emojiKey) <<< _.retry) conflicted.reaction.settingsProblem == Just (Just (map emojiKey intended)))
  let
    refreshed = step conflicted (SettingsLoaded me.id (Right { profileId: me.id, revision: 4, favorites: [ party ] }))
    retried = step refreshed RetrySettings
  assertEqual "retry sends the intended list" (favorites retried) (map emojiKey intended)
  -- 422 (unavailable newly added): no retry.
  let
    refusedUnavailable = step added (SettingsSaved me.id previous intended (Left (EmojiUnavailable "gone")))
  assertTrue "422 has no retry" (map _.retry refusedUnavailable.reaction.settingsProblem == Just Nothing)
  -- At most five, no duplicates.
  let
    five = ready { reaction = ready.reaction { settings = Loaded { profileId: me.id, revision: 1, favorites: map unicode [ "😀", "😂", "🥹", "😊", "😍" ] } } }
  assertTrue "no add picker at five" (isNothing (step five (OpenPicker AddFavorite "sp-fav-add")).reaction.picker)
  assertEqual "duplicate not added" (favorites (step (step ready (OpenPicker AddFavorite "x")) (Pick thumbs))) [ "u:👍", "u:🎉", "c:old_blob" ]
  -- Delete at once, with undo putting it back in place (S2).
  let
    removed = step ready (RemoveFavorite 1)
    removedSaved = step removed (SettingsSaved me.id previous [ thumbs, oldBlob ] (Right { profileId: me.id, revision: 4, favorites: [ thumbs, oldBlob ] }))
    undone = step removedSaved ToastUndo
  assertEqual "removed" (favorites removed) [ "u:👍", "c:old_blob" ]
  assertEqual "undo puts it back" (favorites undone) [ "u:👍", "u:🎉", "c:old_blob" ]
  -- 左へ / drag reorder keeps an unavailable favourite (S3 / S4).
  assertEqual "move left" (favorites (step ready (MoveFavorite 2 1))) [ "u:👍", "c:old_blob", "u:🎉" ]
  assertEqual "replace" (favorites (step (step ready (StartReplaceFavorite 2)) (Pick (unicode "🔥")))) [ "u:👍", "u:🎉", "u:🔥" ]
  where
  favorites model = case model.reaction.settings of
    Loaded settings -> map emojiKey settings.favorites
    _ -> []

testDetailFilter :: Effect Unit
testDetailFilter = do
  assertEqual "starts with すべて" ready.reaction.detailFilter AllReactors
  let
    closed = step ready (SelectDetailFilter AllReactors)
  assertEqual "selected again closes" closed.reaction.detailFilter ListClosed
  assertEqual "an emoji" (step closed (SelectDetailFilter (OnlyEmoji "u:🎉"))).reaction.detailFilter (OnlyEmoji "u:🎉")
  assertEqual "opening the tab again shows すべて" (QR.detailReactionsOpened closed).reaction.detailFilter AllReactors

testNavigationConfirmsRemoval :: Effect Unit
testNavigationConfirmsRemoval = do
  let
    removed = step ready (RemoveMine sora)
    Tuple left effects = QR.leaveScreen removed
  assertTrue "navigation sends the removal" (isNothing left.reaction.pendingRemoval && length effects >= 1)
  assertTrue "undo toast dropped (confirmed)" (isNothing left.reaction.toast)
  assertEqual "reaction stays removed" (mineOn left sora.noteId) Nothing
  -- The serialized model (SSR state) keeps the reaction state.
  assertTrue "round trip" (map _.reaction.profileId (hush (decodeJson (encodeJson removed)) :: Maybe Model) == Just (Just me.id))
