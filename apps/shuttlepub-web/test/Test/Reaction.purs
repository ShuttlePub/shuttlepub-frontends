-- | Quick reaction (D03) rules and state transitions (Client.Reaction.update), checked
-- | on the model. Effects (requests, focus, timers) are not run here; their outcome
-- | messages are fed back by hand, as the runtime would.
module Test.Reaction (testReaction) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Emoji (Emoji, EmojiKind(..), emojiKey, unicode)
import App.Model (Model, RemoteData(..), initialModel)
import App.Reaction (DetailFilter(..), HoldReason(..), PickerTarget(..), PostReactions, QuickSettings, ReactionMsg(..), ToastKind(..), chipsOf, moveItem, reactorRows, totalCount)
import App.Route (Route(..))
import Client.Reaction as QR
import Data.Argonaut.Decode (decodeJson)
import Data.Argonaut.Encode (encodeJson)
import Data.Array (length)
import Data.Array as Array
import Data.Either (Either(..), hush)
import Data.Maybe (Maybe(..), isJust, isNothing, maybe)
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

-- | The request id in flight for a Note (what its answer carries).
requestOf :: Model -> String -> Int
requestOf model noteId = maybe 0 _.request (Array.find (\entry -> entry.post.noteId == noteId && entry.started) model.reactionWrites.notes)

busyOn :: Model -> String -> Boolean
busyOn model noteId = Array.any (\entry -> entry.post.noteId == noteId && entry.started) model.reactionWrites.notes

saved :: Model -> { postId :: String, noteId :: String } -> Either ApiError (Maybe Emoji) -> Model
saved model post result = step model (ReactionSaved model.reaction.epoch (requestOf model post.noteId) post Nothing result)

expire :: Model -> Model
expire model = case model.reaction.toast of
  Just toast -> step model (ToastExpired toast.id toast.armed)
  Nothing -> model

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
  testToastReplacementConfirmsRemoval
  testDeleteSerializesWithPut
  testFailedReselectKeepsRemoval
  testPageRestored
  testFavoriteUndoWhileSaving
  testToastHoldReasons
  testProfileRoundTrip
  testRemovalFailureClosesPicker
  testCompletedDeleteRejectsOldGet
  testFailedReselectAfterSwitch
  testQueuedProfileRoundTrip
  testSettingsLaneRoundTrip
  testRestoreWaits
  testConflictRefetchFailureRetry
  testFetchedReactionRestoresUi

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
  assertTrue "request in flight" (busyOn picked mika.noteId)
  let
    done = saved picked mika (Right (Just thumbs))
  assertTrue "settled" (not (busyOn done mika.noteId))
  -- Reacted: no picker (no replacement from the picker); my chip removes it.
  assertTrue "no picker while reacted" (isNothing (step done (OpenPicker (ReactTo mika) "x")).reaction.picker)
  assertEqual "someone's chip does nothing while reacted" (mineOn (step done (ReactWithChip mika party)) mika.noteId) (Just thumbs)
  let
    removed = step done (RemoveMine mika)
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
      assertTrue "removal sent" (length effects >= 1 && busyOn expired mika.noteId)
      -- While hovered the toast stays (注意 3).
      let
        held = step removed (ToastHold HoldHover true)
      assertTrue "held toast stays" (isJust (step held (ToastExpired toast.id toast.armed)).reaction.toast)
      let
        released = step held (ToastHold HoldHover false)
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
  assertEqual "one request in flight" (Array.length (Array.filter (\entry -> entry.post.noteId == mika.noteId) second.reactionWrites.notes)) 1
  assertTrue "removal ignored while in flight" (isNothing (step first (RemoveMine mika)).reaction.pendingRemoval)
  let
    failed = saved first mika (Left (NotImplemented "501"))
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
        sent = expire removed
        refused = step sent (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId) removal (Left (UpstreamError "500")))
      assertEqual "failed removal restores" (mineOn refused sora.noteId) (Just party)
      assertTrue "failed removal settles" (not (busyOn refused sora.noteId))
      assertTrue "failed removal shown"
        ( case refused.reaction.toast of
            Just { kind: ReactionFailed _ _ } -> true
            _ -> false
        )
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
    late = step switched (PostReactionsLoaded busy.reaction.epoch (map (\entry -> { noteId: entry.noteId, sequence: 0 }) reactions) (Right reactions))
  assertEqual "late reactions ignored" (length late.reaction.posts) 0
  assertTrue "late settings ignored" ((step switched (SettingsLoaded busy.reaction.epoch busy.reaction.settingsRequest (Right { profileId: me.id, revision: 3, favorites: [ thumbs ] }))).reaction.settings == Loading)
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
    conflicted = settingsSaved added previous intended (Left (RevisionConflict "stale"))
  assertEqual "conflict shows the stored list" (favorites conflicted) [ "u:👍", "u:🎉", "c:old_blob" ]
  assertTrue "conflict offers a retry" (map (map (map emojiKey) <<< _.retry) conflicted.reaction.settingsProblem == Just (Just (map emojiKey intended)))
  let
    refreshed = step conflicted (SettingsLoaded conflicted.reaction.epoch conflicted.reaction.settingsRequest (Right { profileId: me.id, revision: 4, favorites: [ party ] }))
    retried = step refreshed RetrySettings
  assertEqual "retry sends the intended list" (favorites retried) (map emojiKey intended)
  -- 422 (unavailable newly added): no retry.
  let
    refusedUnavailable = settingsSaved added previous intended (Left (EmojiUnavailable "gone"))
  assertTrue "422 has no retry" (map _.retry refusedUnavailable.reaction.settingsProblem == Just Nothing)
  -- At most five, no duplicates.
  let
    five = ready { reaction = ready.reaction { settings = Loaded { profileId: me.id, revision: 1, favorites: map unicode [ "😀", "😂", "🥹", "😊", "😍" ] } } }
  assertTrue "no add picker at five" (isNothing (step five (OpenPicker AddFavorite "sp-fav-add")).reaction.picker)
  assertEqual "duplicate not added" (favorites (step (step ready (OpenPicker AddFavorite "x")) (Pick thumbs))) [ "u:👍", "u:🎉", "c:old_blob" ]
  -- Delete at once, with undo putting it back in place (S2).
  let
    removed = step ready (RemoveFavorite 1)
    removedSaved = settingsSaved removed previous [ thumbs, oldBlob ] (Right { profileId: me.id, revision: 4, favorites: [ thumbs, oldBlob ] })
    undone = step removedSaved ToastUndo
  assertEqual "removed" (favorites removed) [ "u:👍", "c:old_blob" ]
  assertEqual "undo puts it back" (favorites undone) [ "u:👍", "u:🎉", "c:old_blob" ]
  -- 左へ / drag reorder keeps an unavailable favourite (S3 / S4).
  assertEqual "move left" (favorites (step ready (MoveFavorite 2 1))) [ "u:👍", "c:old_blob", "u:🎉" ]
  assertEqual "replace" (favorites (step (step ready (StartReplaceFavorite 2)) (Pick (unicode "🔥")))) [ "u:👍", "u:🎉", "u:🔥" ]

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

favorites :: Model -> Array String
favorites model = case model.reaction.settings of
  Loaded settings -> map emojiKey settings.favorites
  _ -> []

settingsSaved :: Model -> QuickSettings -> Array Emoji -> Either ApiError QuickSettings -> Model
settingsSaved model previous intended result =
  step model (SettingsSaved model.reaction.epoch model.reaction.settingsRequest previous intended result)

isUndoOf :: Model -> String -> Boolean
isUndoOf model noteId = case model.reaction.toast of
  Just { kind: UndoRemoval removal } -> removal.post.noteId == noteId
  _ -> false

-- | Review #1 (D03 q09): another toast replacing the undo toast ends the undo
-- | opportunity, so the removal is sent then (and not lost).
testToastReplacementConfirmsRemoval :: Effect Unit
testToastReplacementConfirmsRemoval = do
  let
    withMika = ready { reaction = ready.reaction { posts = setMineIn mika.noteId (Just thumbs) ready.reaction.posts } }
    first = step withMika (RemoveMine sora)
    second = step first (RemoveMine mika)
  assertTrue "first removal sent when replaced" (busyOn second sora.noteId)
  assertTrue "second removal pending" (map _.post.noteId second.reaction.pendingRemoval == Just mika.noteId && isUndoOf second mika.noteId)
  -- A failure toast replacing it also sends it.
  let
    failing = step (step first (OpenPicker (ReactTo mika) "x")) (PickUnavailableFavorite oldBlob)
  assertTrue "removal sent when a notice replaces the toast" (busyOn failing sora.noteId && isNothing failing.reaction.pendingRemoval)
  -- The toast going away sends it (only once).
  let
    expired = expire first
  assertEqual "sent once" (Array.length (Array.filter (\entry -> entry.post.noteId == sora.noteId) expired.reactionWrites.notes)) 1
  assertTrue "undo after confirmation does nothing" (mineOn (step expired ToastUndo) sora.noteId == Nothing)

-- | Review #2: a DELETE in flight is the request of its Note; nothing else is sent for
-- | it until it answers, and a fetch does not overwrite it.
testDeleteSerializesWithPut :: Effect Unit
testDeleteSerializesWithPut = do
  let
    sent = expire (step ready (RemoveMine sora))
  assertTrue "DELETE in flight" (busyOn sent sora.noteId)
  assertTrue "no picker while DELETE in flight" (isNothing (step sent (OpenPicker (ReactTo sora) "x")).reaction.picker)
  assertEqual "no PUT while DELETE in flight" (mineOn (step sent (ReactWithChip sora thumbs)) sora.noteId) Nothing
  let
    stale = step sent (PostReactionsLoaded sent.reaction.epoch (map (\entry -> { noteId: entry.noteId, sequence: 0 }) reactions) (Right reactions))
  assertEqual "fetch keeps the removal in flight" (mineOn stale sora.noteId) Nothing
  let
    pending = step ready (RemoveMine sora)
    staleBeforeSend = step pending (PostReactionsLoaded pending.reaction.epoch (map (\entry -> { noteId: entry.noteId, sequence: 0 }) reactions) (Right reactions))
  assertEqual "fetch keeps the unsent removal" (mineOn staleBeforeSend sora.noteId) Nothing
  case sent.reaction.toast, (step ready (RemoveMine sora)).reaction.pendingRemoval of
    _, Just removal -> do
      let
        done = step sent (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId) removal (Right unit))
      assertTrue "settled after DELETE" (not (busyOn done sora.noteId))
      assertTrue "picker after DELETE" (isJust (step done (OpenPicker (ReactTo sora) "x")).reaction.picker)
      -- An answer for an older request is not taken as the current one.
      let
        old = step sent (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId - 1) removal (Left (UpstreamError "late")))
      assertEqual "older answer ignored" (mineOn old sora.noteId) Nothing
      assertTrue "older answer leaves the request in flight" (busyOn old sora.noteId)
    _, Nothing -> throw "expected a removal"

-- | Review #3: re-reacting while the removal is unsent replaces it; when that PUT
-- | fails, the removal is sent after all (the post ends without a reaction).
testFailedReselectKeepsRemoval :: Effect Unit
testFailedReselectKeepsRemoval = do
  let
    removed = step ready (RemoveMine sora)
    reselected = step removed (ReactWithChip sora thumbs)
  assertTrue "removal not sent on re-react" (isNothing reselected.reaction.pendingRemoval && not (isUndoOf reselected sora.noteId))
  case removed.reaction.pendingRemoval of
    Just removal -> do
      let
        failed = step reselected (ReactionSaved reselected.reaction.epoch (requestOf reselected sora.noteId) sora (Just removal) (Left (EmojiUnavailable "gone")))
      assertEqual "back to not reacted" (mineOn failed sora.noteId) Nothing
      assertTrue "the removal is sent after all" (busyOn failed sora.noteId && requestOf failed sora.noteId /= requestOf reselected sora.noteId)
      let
        ok = step reselected (ReactionSaved reselected.reaction.epoch (requestOf reselected sora.noteId) sora (Just removal) (Right (Just thumbs)))
      assertEqual "success keeps the new reaction" (mineOn ok sora.noteId) (Just thumbs)
      assertTrue "nothing else sent on success" (not (busyOn ok sora.noteId))
    Nothing -> throw "expected a removal"

-- | Review #4: back from the back/forward cache, pagehide already handed the removal
-- | to keepalive. Its undo is over, nothing is resent and the screen is read again.
testPageRestored :: Effect Unit
testPageRestored = do
  let
    removed = step ready (RemoveMine sora)
    Tuple restored effects = QR.update removed PageRestored
  assertTrue "pending removal dropped (not resent)" (isNothing restored.reaction.pendingRemoval && not (busyOn restored sora.noteId))
  assertTrue "undo toast gone" (isNothing restored.reaction.toast)
  assertTrue "new generation" (restored.reaction.epoch /= removed.reaction.epoch)
  assertTrue "reloading" (restored.reaction.settings == Loading && length effects >= 2)
  case removed.reaction.toast of
    Just toast -> do
      let
        late = step restored (ToastExpired toast.id toast.armed)
      assertTrue "old timer sends nothing" (not (busyOn late sora.noteId))
    Nothing -> throw "expected a toast"
  assertEqual "undo does nothing locally" (mineOn (step restored ToastUndo) sora.noteId) (mineOn restored sora.noteId)
  -- An answer from before the restore is dropped.
  let
    inFlight = step ready (ReactWithChip mika thumbs)
    Tuple back _ = QR.update inFlight PageRestored
    late = step back (ReactionSaved inFlight.reaction.epoch (requestOf inFlight mika.noteId) mika Nothing (Left (UpstreamError "x")))
  assertTrue "old answer dropped" (isNothing late.reaction.toast)

-- | Review #5: the undo of a favourite deletion waits for the deletion to be saved;
-- | pressing it meanwhile does not lose it (the toast stays and it can be pressed later).
testFavoriteUndoWhileSaving :: Effect Unit
testFavoriteUndoWhileSaving = do
  let
    previous = { profileId: me.id, revision: 3, favorites: [ thumbs, party, oldBlob ] }
    removed = step ready (RemoveFavorite 1)
    early = step removed ToastUndo
  assertTrue "toast stays while saving" (isJust early.reaction.toast)
  assertEqual "nothing changed yet" (favorites early) [ "u:👍", "c:old_blob" ]
  let
    kept = expire removed
  assertTrue "toast does not expire while saving" (isJust kept.reaction.toast)
  let
    savedDeletion = settingsSaved early previous [ thumbs, oldBlob ] (Right { profileId: me.id, revision: 4, favorites: [ thumbs, oldBlob ] })
    undone = step savedDeletion ToastUndo
  assertEqual "undo runs after the save" (favorites undone) [ "u:👍", "u:🎉", "c:old_blob" ]
  -- S2 exception: deleting an unavailable favourite says 削除しました without 元に戻す
  -- (it could not be added back: S3 answers 422).
  let
    removedUnavailable = step ready (RemoveFavorite 2)
  assertEqual "unavailable removed" (favorites removedUnavailable) [ "u:👍", "u:🎉" ]
  assertTrue "plain notice, no undo"
    ( case removedUnavailable.reaction.toast of
        Just { kind: FavoriteRemoved _ } -> true
        _ -> false
    )
  let
    afterSave = settingsSaved removedUnavailable previous [ thumbs, party ] (Right { profileId: me.id, revision: 4, favorites: [ thumbs, party ] })
  assertEqual "nothing to undo" (favorites (step afterSave ToastUndo)) [ "u:👍", "u:🎉" ]
  assertTrue "undo press does not save" (not (step afterSave ToastUndo).reaction.savingSettings)
  -- A failed deletion ends its undo (there is nothing to undo).
  let
    failed = settingsSaved removed previous [ thumbs, oldBlob ] (Left (UpstreamError "500"))
  assertTrue "failed deletion drops its undo" (isNothing failed.reaction.toast)

-- | Review #7 (注意 3): hover, touch and focus hold the toast each on their own.
testToastHoldReasons :: Effect Unit
testToastHoldReasons = do
  let
    removed = step ready (RemoveMine sora)
    focused = step (step removed (ToastHold HoldFocus true)) (ToastHold HoldHover true)
    pointerLeft = step focused (ToastHold HoldHover false)
  case pointerLeft.reaction.toast of
    Just toast -> do
      assertTrue "still held by focus" (isJust (step pointerLeft (ToastExpired toast.id toast.armed)).reaction.toast)
      let
        blurred = step pointerLeft (ToastHold HoldFocus false)
      case blurred.reaction.toast of
        Just again -> do
          assertTrue "timer restarts when nothing holds" (again.armed /= toast.armed)
          assertTrue "and then it goes" (isNothing (step blurred (ToastExpired again.id again.armed)).reaction.toast)
        Nothing -> throw "expected the toast"
    Nothing -> throw "expected a toast"
  let
    touched = step (step (step removed (ToastHold HoldTouch true)) (ToastHold HoldHover true)) (ToastHold HoldTouch false)
  assertTrue "hover still holds after touch ends" (map (_.holds.hover) touched.reaction.toast == Just true)

-- | Review #8: Profile A -> B -> A drops the answers of the first A context.
testProfileRoundTrip :: Effect Unit
testProfileRoundTrip = do
  let
    first = step ready (ReactWithChip mika thumbs)
    toOther = fst (QR.syncProfile (first { profileContext = Loaded { activeProfile: Just other } }))
    back = fst (QR.syncProfile (toOther { profileContext = Loaded { activeProfile: Just me } }))
  assertEqual "acting Profile back to A" back.reaction.profileId (Just me.id)
  assertTrue "new generation" (back.reaction.epoch /= first.reaction.epoch)
  let
    lateSave = step back (ReactionSaved first.reaction.epoch (requestOf first mika.noteId) mika Nothing (Right (Just thumbs)))
    lateList = step back (PostReactionsLoaded first.reaction.epoch (map (\entry -> { noteId: entry.noteId, sequence: 0 }) reactions) (Right reactions))
    lateSettings = step back (SettingsLoaded first.reaction.epoch first.reaction.settingsRequest (Right { profileId: me.id, revision: 1, favorites: [] }))
  assertEqual "late PUT answer dropped" (mineOn lateSave mika.noteId) Nothing
  assertEqual "late list dropped" (length lateList.reaction.posts) 0
  assertTrue "late settings dropped" (lateSettings.reaction.settings == Loading)
  let
    current = step lateSave (PostReactionsLoaded back.reaction.epoch (readSnapshot lateSave) (Right reactions))
  assertEqual "current answer taken" (length current.reaction.posts) (length reactions)

-- | Review #9 (注意 2 / 6): a removal that fails brings my chip back and closes the
-- | picker anchored on the reaction button it replaces.
testRemovalFailureClosesPicker :: Effect Unit
testRemovalFailureClosesPicker = do
  let
    removed = step ready (RemoveMine sora)
  case removed.reaction.pendingRemoval of
    Just removal -> do
      let
        sent = expire removed
        -- A picker on the post (opened before the DELETE was counted, e.g. restored state).
        withPicker = sent { reaction = sent.reaction { picker = Just { target: ReactTo sora, query: "", category: "face", opener: "react-post-sora-zine" } } }
        refused = step withPicker (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId) removal (Left (UpstreamError "500")))
      assertEqual "my chip back" (mineOn refused sora.noteId) (Just party)
      assertTrue "picker closed" (isNothing refused.reaction.picker)
      let
        otherPicker = sent { reaction = sent.reaction { picker = Just { target: ReactTo mika, query: "", category: "face", opener: "react-post-mika-picker" } } }
        kept = step otherPicker (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId) removal (Left (UpstreamError "500")))
      assertTrue "another post's picker stays" (isJust kept.reaction.picker)
    Nothing -> throw "expected a removal"

setMineIn :: String -> Maybe Emoji -> Array PostReactions -> Array PostReactions
setMineIn noteId mine = map (\entry -> if entry.noteId == noteId then entry { mine = mine } else entry)

-- | Snapshot exactly what loadPosts captures when its GET starts.
readSnapshot :: Model -> Array { noteId :: String, sequence :: Int }
readSnapshot model = map
  ( \entry ->
      { noteId: entry.noteId
      , sequence: maybe 0 _.sequence (Array.find (\version -> Just version.profileId == model.reaction.profileId && version.noteId == entry.noteId) model.reactionWrites.versions)
      }
  )
  reactions

-- F1: the GET starts first, but arrives AFTER the DELETE is completely settled.
testCompletedDeleteRejectsOldGet :: Effect Unit
testCompletedDeleteRejectsOldGet = do
  let
    snapshot = readSnapshot ready
    removed = step ready (RemoveMine sora)
    sent = expire removed
  case removed.reaction.pendingRemoval of
    Nothing -> throw "expected removal"
    Just removal -> do
      let
        done = step sent (RemovalSent sent.reaction.epoch (requestOf sent sora.noteId) removal (Right unit))
        late = step done (PostReactionsLoaded done.reaction.epoch snapshot (Right reactions))
      assertTrue "DELETE completed before old GET arrives" (not (busyOn done sora.noteId))
      assertEqual "old GET never resurrects completed removal" (mineOn late sora.noteId) Nothing
      assertEqual "unmodified keys from old GET still apply" (length late.reaction.posts) 2
      let
        fresh = step done (PostReactionsLoaded done.reaction.epoch (readSnapshot done) (Right (setMineIn sora.noteId Nothing reactions)))
      assertEqual "GET started after DELETE is accepted" (mineOn fresh sora.noteId) Nothing

-- F2: cleanup is executed against A despite the screen now showing B.
testFailedReselectAfterSwitch :: Effect Unit
testFailedReselectAfterSwitch = do
  let
    removed = step ready (RemoveMine sora)
    put = step removed (ReactWithChip sora thumbs)
    switched = fst (QR.syncProfile (put { profileContext = Loaded { activeProfile: Just other } }))
    Tuple failed effects = QR.update switched (ReactionSaved put.reaction.epoch (requestOf put sora.noteId) sora Nothing (Left (UpstreamError "failed")))
  assertEqual "B remains visible" failed.reaction.profileId (Just other.id)
  assertTrue "no A data or failure toast mixed into B" (Array.null failed.reaction.posts && isNothing failed.reaction.toast)
  assertTrue "cleanup effect issued even after switch" (length effects > 0)
  case Array.head failed.reactionWrites.notes of
    Just cleanup -> do
      assertEqual "cleanup targets original Profile A" cleanup.profileId me.id
      assertTrue "cleanup is a started DELETE with original removal" (cleanup.started && isNothing cleanup.mine && isJust cleanup.removal)
      case cleanup.removal of
        Just removal -> do
          let done = step failed (RemovalSent cleanup.epoch cleanup.request removal (Right unit))
          assertTrue "cleanup drains original lane" (Array.null done.reactionWrites.notes)
        Nothing -> throw "expected cleanup"
    Nothing -> throw "cleanup lost"

-- F3: A PUT1 is deliberately unresolved through A -> B -> A -> PUT2.
testQueuedProfileRoundTrip :: Effect Unit
testQueuedProfileRoundTrip = do
  let
    first = step ready (ReactWithChip mika thumbs)
    toB = fst (QR.syncProfile (first { profileContext = Loaded { activeProfile: Just other } }))
    back = fst (QR.syncProfile (toB { profileContext = Loaded { activeProfile: Just me } }))
    Tuple second effects = QR.update back (ReactWithChip mika party)
    writes = Array.filter (\write -> write.post.noteId == mika.noteId) second.reactionWrites.notes
    independent = step toB (ReactWithChip mika party)
  assertEqual "both intents retained FIFO" (map _.mine writes) [ Just thumbs, Just party ]
  assertEqual "another Profile has an independent lane" (map _.started independent.reactionWrites.notes) [ true, true ]
  assertEqual "PUT2 has not been sent before PUT1 answers" (map _.started writes) [ true, false ]
  assertEqual "only focus effect before PUT1 answers" (length effects) 1
  let
    Tuple afterFirst sent = QR.update second (ReactionSaved first.reaction.epoch (requestOf first mika.noteId) mika Nothing (Right (Just thumbs)))
  assertEqual "PUT1 response cannot replace PUT2 optimistic state" (mineOn afterFirst mika.noteId) (Just party)
  assertEqual "PUT2 issued only after PUT1 completion" (map _.started afterFirst.reactionWrites.notes) [ true ]
  assertEqual "one network effect for PUT2" (length sent) 1
  let
    Tuple duplicate duplicateEffects = QR.update afterFirst (ReactionSaved first.reaction.epoch (requestOf first mika.noteId) mika Nothing (Right (Just thumbs)))
  assertEqual "duplicate completion cannot issue PUT2 twice" (length duplicateEffects) 0
  assertEqual "duplicate completion leaves PUT2 intact" (map _.request duplicate.reactionWrites.notes) (map _.request afterFirst.reactionWrites.notes)
  let
    done = saved afterFirst mika (Right (Just party))
  assertTrue "lane drained" (Array.null done.reactionWrites.notes)
  assertEqual "final server response is PUT2" (mineOn done mika.noteId) (Just party)
  let
    Tuple failedSecond retryRead = QR.update afterFirst (ReactionSaved afterFirst.reaction.epoch (requestOf afterFirst mika.noteId) mika Nothing (Left (UpstreamError "PUT2 failed")))
    serverTruth = step failedSecond (PostReactionsLoaded failedSecond.reaction.epoch (readSnapshot failedSecond) (Right (setMineIn mika.noteId (Just thumbs) reactions)))
  assertTrue "failed PUT2 revalidates the successful PUT1 (timer, focus, GET)" (length retryRead == 3 && Array.null failedSecond.reactionWrites.notes)
  assertEqual "PUT2 failure restores server truth from PUT1" (mineOn serverTruth mika.noteId) (Just thumbs)
  -- Failure cleanup is also before PUT2, even after A -> B -> A.
  let
    reselected = step (step ready (RemoveMine sora)) (ReactWithChip sora thumbs)
    b = fst (QR.syncProfile (reselected { profileContext = Loaded { activeProfile: Just other } }))
    a = fst (QR.syncProfile (b { profileContext = Loaded { activeProfile: Just me } }))
    queued = step a (ReactWithChip sora party)
    cleanup = step queued (ReactionSaved reselected.reaction.epoch (requestOf reselected sora.noteId) sora Nothing (Left (UpstreamError "failed")))
  assertEqual "cleanup precedes PUT2" (map _.mine cleanup.reactionWrites.notes) [ Nothing, Just party ]
  assertEqual "PUT2 waits for cleanup" (map _.started cleanup.reactionWrites.notes) [ true, false ]

-- Common settings use the same lifetime rule, with a Profile-wide busy lane.
testSettingsLaneRoundTrip :: Effect Unit
testSettingsLaneRoundTrip = do
  let
    previous = { profileId: me.id, revision: 3, favorites: [ thumbs, party, oldBlob ] }
    first = step ready (MoveFavorite 1 0)
    b = fst (QR.syncProfile (first { profileContext = Loaded { activeProfile: Just other } }))
    a = fst (QR.syncProfile (b { profileContext = Loaded { activeProfile: Just me } }))
  assertTrue "A settings editor waits for old save" (a.reaction.savingSettings && a.reaction.settings == Loading)
  assertEqual "no overlapping settings mutation" (length (step a (RemoveFavorite 0)).reactionWrites.settings) 1
  let
    Tuple completed effects = QR.update a (SettingsSaved first.reaction.epoch first.reaction.settingsRequest previous [ party, thumbs, oldBlob ] (Right previous { revision = 4, favorites = [ party, thumbs, oldBlob ] }))
  assertTrue "save settled independent of epoch" (Array.null completed.reactionWrites.settings)
  assertTrue "fresh revision fetched after old save" (length effects == 1 && completed.reaction.settings == Loading)

-- F4 model half: no reads or actions while keepalive is unresolved.
testRestoreWaits :: Effect Unit
testRestoreWaits = do
  let
    removed = step ready (RemoveMine sora)
    Tuple waiting effects = QR.update removed PageRestoring
  assertTrue "waiting with undo ended" (waiting.reaction.restoring && isNothing waiting.reaction.pendingRemoval && isNothing waiting.reaction.toast)
  assertEqual "only DOM cleanup, no early GET" (length effects) 1
  assertEqual "PUT blocked during restore" (length (step waiting (ReactWithChip mika thumbs)).reactionWrites.notes) 0
  assertEqual "settings save blocked during restore" (length (step waiting (RemoveFavorite 0)).reactionWrites.settings) 0
  let
    Tuple restored reads = QR.update waiting PageRestored
  assertTrue "after keepalive settled revalidation starts" (not restored.reaction.restoring && restored.reaction.settings == Loading && length reads >= 2)

-- F5: 409 -> refetch fails -> retry obtains a revision -> saves retained intent.
testConflictRefetchFailureRetry :: Effect Unit
testConflictRefetchFailureRetry = do
  let
    previous = { profileId: me.id, revision: 3, favorites: [ thumbs, party, oldBlob ] }
    intended = [ party, thumbs, oldBlob ]
    saving = step ready (MoveFavorite 1 0)
    conflict = settingsSaved saving previous intended (Left (RevisionConflict "stale"))
    failed = step conflict (SettingsLoaded conflict.reaction.epoch conflict.reaction.settingsRequest (Left (UpstreamError "offline")))
    Tuple retry effects = QR.update failed RetrySettings
  assertTrue "refetch really failed"
    ( case failed.reaction.settings of
        Failed _ -> true
        _ -> false
    )
  assertTrue "retry launches GET and disables duplicate retry" (retry.reaction.settings == Loading && retry.reaction.savingSettings && length effects == 1)
  let
    againFailed = step retry (SettingsLoaded retry.reaction.epoch retry.reaction.settingsRequest (Left (UpstreamError "still offline")))
  assertTrue "another GET failure releases retry" (not againFailed.reaction.savingSettings && isJust againFailed.reaction.settingsProblem)
  let
    reloaded = step retry (SettingsLoaded retry.reaction.epoch retry.reaction.settingsRequest (Right previous { revision = 5, favorites = [ party ] }))
  assertEqual "retained intent saved after successful refetch" (favorites reloaded) (map emojiKey intended)
  assertTrue "fresh-revision PUT now started" (reloaded.reaction.savingSettings && length reloaded.reactionWrites.settings == 1)

-- F6: a PUT was stored but its reply failed; GET restores the server reaction.
-- The same transition owns picker closure, not only direct PUT/undo responses.
testFetchedReactionRestoresUi :: Effect Unit
testFetchedReactionRestoresUi = do
  let
    shown = ready
      { timeline = Loaded
          ( map
              ( \post ->
                  { id: post.postId
                  , noteId: post.noteId
                  , author: me
                  , text: "fixture"
                  , createdAt: "2026-11-11T00:00:00Z"
                  , replyCount: 0
                  , repostCount: 0
                  , repostedBy: Nothing
                  , inReplyToId: Nothing
                  }
              )
              [ sora, mika ]
          )
      }
    put = step shown (ReactWithChip mika thumbs)
    failed = saved put mika (Left (UpstreamError "reply lost after save"))
    reopened = step failed (OpenPicker (ReactTo mika) "react-post-mika-picker")
    server = setMineIn mika.noteId (Just thumbs) reactions
    Tuple restored focusEffects = QR.update reopened (PostReactionsLoaded reopened.reaction.epoch (readSnapshot reopened) (Right server))
  assertTrue "picker opened while revalidation waited" (isJust reopened.reaction.picker)
  assertEqual "GET restores stored reaction" (mineOn restored mika.noteId) (Just thumbs)
  assertTrue "GET closes restored post's picker" (isNothing restored.reaction.picker)
  assertEqual "source-aware focus repair scheduled once" (length focusEffects) 1
  let
    unrelated = step failed (OpenPicker AddFavorite "sp-fav-add")
    Tuple other _ = QR.update unrelated (PostReactionsLoaded unrelated.reaction.epoch (readSnapshot unrelated) (Right server))
  assertEqual "unrelated picker remains open" (map _.target other.reaction.picker) (Just AddFavorite)
  let
    Tuple stale staleEffects = QR.update reopened (PostReactionsLoaded reopened.reaction.epoch (readSnapshot shown) (Right server))
  assertEqual "stale GET cannot restore reaction" (mineOn stale mika.noteId) Nothing
  assertTrue "stale GET cannot close picker or move focus" (isJust stale.reaction.picker && length staleEffects == 0)
  let
    Tuple duplicate duplicateEffects = QR.update restored (PostReactionsLoaded restored.reaction.epoch (readSnapshot restored) (Right server))
  assertEqual "unchanged response has no focus effect" (length duplicateEffects) 0
  assertTrue "unchanged response leaves picker closed" (isNothing duplicate.reaction.picker)
