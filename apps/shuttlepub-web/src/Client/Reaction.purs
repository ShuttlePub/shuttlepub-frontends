-- | Update of the quick reaction UI (D03). Client.Update delegates `Reaction` messages
-- | here and calls the hooks (Profile change, posts shown, navigation, Esc) at the
-- | points the shell owns.
-- |
-- | Rules from ui-spec v6 (host intents/shuttlepub/features/quick-reaction-ui):
-- |  - 1 Profile, 1 post, 1 reaction; no replacement from the picker (C1, D03 q06).
-- |  - Whenever a post becomes reacted (pick, someone's chip, undo, a failed removal
-- |    coming back) every UI anchored on its reaction button closes and focus goes to
-- |    my chip; after removal focus goes to the reaction button (実装上の注意 1, 2, 6).
-- |  - Removal is shown at once; DELETE is sent when the undo opportunity ends: the
-- |    undo toast expires, is replaced or dropped, the screen changes or the page is
-- |    hidden. Undo sends nothing (D03 q09). The pending removal and the undo toast
-- |    always come and go together (setToast).
-- |  - Transport lives in Model.reactionWrites, outside the screen generation:
-- |    FIFO per Profile x Note (PUT, DELETE and failure cleanup alike), one settings
-- |    save per Profile. Switching / restoring never discards outstanding writes.
-- |  - Every write is settled, but only the current epoch may change visible UI.
-- |    GETs carry starting write sequences; a changed / busy key is discarded even
-- |    if the mutation has already completed by the time the GET arrives.
module Client.Reaction
  ( update
  , syncProfile
  , postsShown
  , leaveScreen
  , escape
  , selectCategory
  , detailReactionsOpened
  , pickerLocksScroll
  , refocusPicker
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.GraphQL (fetchCustomEmojis, fetchPostReactions, fetchQuickSettings, removeNoteReaction, saveQuickSettings, setNoteReaction)
import App.Dom (focusById, focusFirstIn, requestFocus)
import App.Emoji (Emoji, sameEmoji)
import App.Extension.Reaction (chipMenuId, favoriteAddId, favoriteChipId, mineChipId, pickerId, pickerSearchId, pickerTabId)
import App.Message (Message(..))
import App.Model (Model, ReactionModel, RemoteData(..), activeProfile, fromEither, initialReactionModel)
import App.Post (Post)
import App.Reaction (DetailFilter(..), HoldReason(..), NoteRead, NoteWrite, PendingRemoval, PickerTarget(..), PostReactions, PostRef, ReactionMsg(..), ToastKind(..), held, maxFavorites, moveItem, noHolds, postReactionsFor, removeAt, replaceAt)
import App.ReactionDom (clearPendingRemoval, setPendingRemoval)
import App.Route (Route(..))
import Data.Array (any, cons, filter, find, index, insertAt, length, mapMaybe, nub, null, snoc)
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..), fromMaybe, isJust, isNothing, maybe)
import Data.Time.Duration (Milliseconds(..))
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (Aff, delay)
import Effect.Class (liftEffect)

type Effects = Array (Aff (Maybe Message))

type Step = Tuple Model Effects

effect :: Effect Unit -> Aff (Maybe Message)
effect run = liftEffect run $> Nothing

send :: forall a. (a -> ReactionMsg) -> Aff a -> Aff (Maybe Message)
send wrap request = Just <<< Reaction <<< wrap <$> request

-- | The reaction button of a post (F0 App.Extension.Reaction.reactionButtonId).
reactionButtonOf :: String -> String
reactionButtonOf postId = "react-" <> postId

focusPost :: PostRef -> String -> Boolean -> Effect Unit
focusPost post target onlyIfLost = requestFocus { target, firstIn: false, postId: post.postId, onlyIfLost }

focusPicker :: PickerTarget -> String -> Boolean -> Effect Unit
focusPicker owner target firstIn = requestFocus { target, firstIn, postId, onlyIfLost: false }
  where
  postId = case owner of
    ReactTo post -> post.postId
    _ -> ""

withReaction :: Model -> (ReactionModel -> ReactionModel) -> Model
withReaction model f = model { reaction = f model.reaction }

andThen :: (Model -> Step) -> Step -> Step
andThen next (Tuple model effects) = case next model of
  Tuple after more -> Tuple after (effects <> more)

nextRequest :: Model -> Tuple Model Int
nextRequest model =
  let
    request = model.reaction.requestSeq + 1
  in
    Tuple (withReaction model _ { requestSeq = request }) request

-- Toast ------------------------------------------------------------------------------

-- | Toasts with a button keep 6s, plain notices 3s; after the pointer / touch / focus
-- | leaves, 3s (注意 3).
toastLifetime :: ToastKind -> Number
toastLifetime = case _ of
  ReactionFailed _ _ -> 3000.0
  FavoriteRemoved _ -> 3000.0
  _ -> 6000.0

expireAfter :: Number -> Int -> Int -> Aff (Maybe Message)
expireAfter ms id generation = delay (Milliseconds ms) $> Just (Reaction (ToastExpired id generation))

-- | The only way the toast changes (except undo / re-react, which cancel the removal
-- | themselves). Whatever ends the undo opportunity of a pending removal confirms it.
setToast :: Maybe ToastKind -> Model -> Step
setToast next model = confirmPending model # andThen \confirmed -> case next of
  Nothing -> Tuple (withReaction confirmed _ { toast = Nothing }) []
  Just kind ->
    let
      id = confirmed.reaction.toastSeq + 1
    in
      Tuple (withReaction confirmed _ { toast = Just { id, kind, holds: noHolds, armed: id }, toastSeq = id })
        [ expireAfter (toastLifetime kind) id id ]

-- | Send the pending removal now (its undo opportunity is over).
confirmPending :: Model -> Step
confirmPending model = case model.reaction.pendingRemoval of
  Nothing -> Tuple model []
  Just removal ->
    sendRemoval removal (withReaction model _ { pendingRemoval = Nothing })
      # andThen \next -> Tuple next [ effect clearPendingRemoval ]

-- | DELETE joins the same durable lane as PUT. Cleanup uses its original epoch.
sendRemoval :: PendingRemoval -> Model -> Step
sendRemoval removal model = queueRemoval false model.reaction.epoch removal model

queueRemoval :: Boolean -> Int -> PendingRemoval -> Model -> Step
queueRemoval priority epoch removal model =
  let
    Tuple numbered request = nextRequest model
  in
    enqueueNote priority
      { profileId: removal.profileId, epoch, request, post: removal.post, mine: Nothing, removal: Just removal, started: false }
      numbered

-- | Undo / re-react: the removal is never sent.
cancelPending :: Model -> Step
cancelPending model = Tuple (withReaction model _ { pendingRemoval = Nothing }) [ effect clearPendingRemoval ]

-- Profile context --------------------------------------------------------------------

-- | Keep the PostRef as well as the Note key: GET can restore a server-side
-- | reaction after an ambiguous PUT, removing its button and any anchored picker.
shownPosts :: Model -> Array Post
shownPosts model = timeline <> detail <> user
  where
  timeline = case model.timeline of
    Loaded posts | model.route == Just Home -> posts
    _ -> []
  -- Visible posts only (S8): hidden ones have nothing to react to; revealed ones count.
  detail = case model.detail of
    Loaded found -> mapMaybe _.post (maybe [] pure found.view <> found.replies <> model.content.reveals)
    _ -> []
  user = case model.content.user of
    Loaded (Just page) -> mapMaybe _.post (page.posts <> maybe [] _.posts model.content.userRevealed <> model.content.reveals)
    _ -> []

shownNoteIds :: Model -> Array String
shownNoteIds = nub <<< map _.noteId <<< shownPosts

-- | Start a new generation for `profileId` and (re)load everything it shows.
restart :: Maybe String -> Model -> Step
restart profileId model =
  let
    reaction = model.reaction
    epoch = reaction.epoch + 1
    settingsRequest = reaction.requestSeq + 1
    needEmojis = reaction.customEmojis == NotAsked && isJust profileId
    fresh = initialReactionModel
      { profileId = profileId
      , epoch = epoch
      , restoring = reaction.restoring
      , requestSeq = settingsRequest
      , settingsRequest = settingsRequest
      , settings = if isJust profileId then Loading else NotAsked
      , savingSettings = maybe false (settingsBusy model) profileId
      , customEmojis = if needEmojis && not reaction.restoring then Loading else reaction.customEmojis
      , toastSeq = reaction.toastSeq
      }
    loads =
      if reaction.restoring then []
      else case profileId of
        Just id ->
          (if settingsBusy model id then [] else [ send (SettingsLoaded epoch settingsRequest) (fetchQuickSettings id) ])
            <> loadPosts epoch id (shownNoteIds model) model
            <> if needEmojis then [ send CustomEmojisLoaded fetchCustomEmojis ] else []
        Nothing -> []
  in
    Tuple (model { reaction = fresh }) loads

-- | Profile context loaded or switched: if the acting Profile changed, send the
-- | pending removal of the previous one, drop everything of it and load the new one.
syncProfile :: Model -> Step
syncProfile model
  | map _.id (activeProfile model) == model.reaction.profileId = Tuple model []
  | otherwise = confirmPending model # andThen (restart (map _.id (activeProfile model)))

loadPosts :: Int -> String -> Array String -> Model -> Effects
loadPosts epoch profileId noteIds model =
  let
    noteIdsToRead = filter (not <<< noteBusy model profileId) noteIds
    reads = map (\noteId -> { noteId, sequence: writeSequence model profileId noteId }) noteIdsToRead
  in
    if null noteIdsToRead then []
    else [ send (PostReactionsLoaded epoch reads) (fetchPostReactions profileId noteIdsToRead) ]

-- | Posts appeared (timeline / detail loaded): load their reactions for the acting Profile.
postsShown :: Array Post -> Model -> Step
postsShown posts model = case model.reaction.profileId of
  Just profileId | not model.reaction.restoring -> Tuple model (loadPosts model.reaction.epoch profileId (map _.noteId posts) model)
  _ -> Tuple model []

-- | Navigation confirms a pending removal at once (D03 q09) and closes every layer.
leaveScreen :: Model -> Step
leaveScreen model =
  let
    closed = withReaction model _ { picker = Nothing, chipMenu = Nothing, dragFrom = Nothing, detailFilter = AllReactors }
  in
    case model.reaction.toast of
      Just { kind: UndoRemoval _ } -> setToast Nothing closed
      _ -> confirmPending closed

-- | D1: the reactions tab opens on 「すべて」.
detailReactionsOpened :: Model -> Model
detailReactionsOpened model = withReaction model _ { detailFilter = AllReactors }

-- | Esc: the picker, then a favourite's menu. Nothing when neither is open.
escape :: Model -> Maybe Step
escape model
  | isJust model.reaction.picker = Just (closePicker model)
  | Just at <- model.reaction.chipMenu = Just (Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId at)) ])
  | otherwise = Nothing

-- | Modal layers lock the page scroll: the picker as a bottom sheet (mobile) or as
-- | the favourites dialog, and a favourite's menu sheet (mobile).
pickerLocksScroll :: Model -> Boolean
pickerLocksScroll model = case model.reaction.picker of
  Just picker -> model.isMobile || not (isReact picker.target)
  Nothing -> model.isMobile && isJust model.reaction.chipMenu

isReact :: PickerTarget -> Boolean
isReact = case _ of
  ReactTo _ -> true
  _ -> false

-- | The picker switches between popover and sheet at the breakpoint: keep focus in it.
refocusPicker :: Model -> Effects
refocusPicker model = case model.reaction.picker of
  Just picker -> [ effect (focusPicker picker.target ("#" <> pickerId) true) ]
  Nothing -> []

selectCategory :: Model -> String -> Boolean -> Step
selectCategory model category moveFocus = case model.reaction.picker of
  Just picker ->
    Tuple (withReaction model _ { picker = Just picker { category = category, query = "" } })
      (if moveFocus then [ effect (focusPicker picker.target (pickerTabId category) false) ] else [])
  Nothing -> Tuple model []

closePicker :: Model -> Step
closePicker model = case model.reaction.picker of
  Just picker -> Tuple (withReaction model _ { picker = Nothing }) [ effect (focusPicker picker.target picker.opener false) ]
  Nothing -> Tuple model []

-- | 注意 2: a post that becomes reacted loses its reaction button, so a picker
-- | anchored on it closes.
closePickerOf :: String -> ReactionModel -> ReactionModel
closePickerOf postId reaction = case reaction.picker of
  Just { target: ReactTo ref } | ref.postId == postId -> reaction { picker = Nothing }
  _ -> reaction

-- Posts --------------------------------------------------------------------------------

mineOf :: Model -> String -> Maybe Emoji
mineOf model noteId = postReactionsFor model.reaction.posts noteId >>= _.mine

-- | The screen rejects repeated clicks of its own request. A request from a prior
-- | epoch instead lets the new intent queue behind it (A -> B -> A).
busy :: Model -> String -> Boolean
busy model noteId = model.reaction.restoring || any
  (\write -> Just write.profileId == model.reaction.profileId && write.epoch == model.reaction.epoch && write.post.noteId == noteId)
  model.reactionWrites.notes

noteBusy :: Model -> String -> String -> Boolean
noteBusy model profileId noteId = any (\write -> write.profileId == profileId && write.post.noteId == noteId) model.reactionWrites.notes

writeSequence :: Model -> String -> String -> Int
writeSequence model profileId noteId = maybe 0 _.sequence
  (find (\version -> version.profileId == profileId && version.noteId == noteId) model.reactionWrites.versions)

bumpWrite :: String -> String -> Model -> Model
bumpWrite profileId noteId model = model
  { reactionWrites = model.reactionWrites
      { versions = cons { profileId, noteId, sequence: writeSequence model profileId noteId + 1 }
          (filter (\version -> not (version.profileId == profileId && version.noteId == noteId)) model.reactionWrites.versions)
      }
  }

-- | Register first, then issue only the head of this key. A failed replacement's
-- | cleanup has priority over already queued later intents, on the same Profile.
enqueueNote :: Boolean -> NoteWrite -> Model -> Step
enqueueNote priority write model = startNextNote write.profileId write.post.noteId registered
  where
  registered = bumpWrite write.profileId write.post.noteId
    ( model
        { reactionWrites = model.reactionWrites
            { notes = (if priority then cons write else flip snoc write) model.reactionWrites.notes }
        }
    )

startNextNote :: String -> String -> Model -> Step
startNextNote profileId noteId model = case find (\write -> write.profileId == profileId && write.post.noteId == noteId) model.reactionWrites.notes of
  Just write | not write.started ->
    let
      started = bumpWrite profileId noteId
        ( model
            { reactionWrites = model.reactionWrites
                { notes = map (\entry -> if entry.request == write.request then entry { started = true } else entry) model.reactionWrites.notes }
            }
        )
      request = case write.mine, write.removal of
        Just emoji, _ -> [ send (ReactionSaved write.epoch write.request write.post write.removal) (setNoteReaction profileId noteId emoji) ]
        Nothing, Just removal -> [ send (RemovalSent write.epoch write.request removal) (removeNoteReaction profileId noteId) ]
        _, _ -> []
    in
      Tuple started request
  _ -> Tuple model []

noteAnswer :: Model -> Int -> Int -> String -> Maybe NoteWrite
noteAnswer model epoch request noteId = find
  (\write -> write.started && write.epoch == epoch && write.request == request && write.post.noteId == noteId)
  model.reactionWrites.notes

settleNote :: NoteWrite -> Model -> Model
settleNote write model = bumpWrite write.profileId write.post.noteId
  ( model
      { reactionWrites = model.reactionWrites { notes = filter (\entry -> entry.request /= write.request) model.reactionWrites.notes } }
  )

visibleWrite :: Model -> NoteWrite -> Boolean
visibleWrite model write = Just write.profileId == model.reaction.profileId && write.epoch == model.reaction.epoch && not model.reaction.restoring

-- | Once an old epoch's lane drains, re-read the new screen. Reads while a lane is
-- | busy are suppressed, so returning to A never races A's still outstanding PUT.
finishNote :: NoteWrite -> Model -> Step
finishNote write model = startNextNote write.profileId write.post.noteId model # andThen \next ->
  if Just write.profileId == next.reaction.profileId && write.epoch /= next.reaction.epoch && not next.reaction.restoring then
    Tuple next (loadPosts next.reaction.epoch write.profileId [ write.post.noteId ] next)
  else Tuple next []

setMine :: String -> Maybe Emoji -> Array PostReactions -> Array PostReactions
setMine noteId mine posts
  | any (\entry -> entry.noteId == noteId) posts = map (\entry -> if entry.noteId == noteId then entry { mine = mine } else entry) posts
  | otherwise = snoc posts { noteId, mine, others: [] }

readable :: Model -> NoteRead -> Boolean
readable model read = case model.reaction.profileId of
  Just profileId -> read.sequence == writeSequence model profileId read.noteId
    && not (noteBusy model profileId read.noteId)
    && map (_.post.noteId) model.reaction.pendingRemoval /= Just read.noteId
  Nothing -> false

-- | Discard an entire stale key, not just mine: it must not resurrect a completed
-- | DELETE, nor clobber a queued optimistic intent. Other fetched keys still apply.
mergePosts :: Model -> Array NoteRead -> Array PostReactions -> Array PostReactions
mergePosts model reads fetched = accepted <> filter (\entry -> not (any (\new -> new.noteId == entry.noteId) accepted)) model.reaction.posts
  where
  accepted = filter (\entry -> any (\read -> read.noteId == entry.noteId && readable model read) reads) fetched

-- | Become reacted (picker / someone's chip): optimistic, one request per Note.
react :: PostRef -> Emoji -> Model -> Step
react post emoji model = case model.reaction.profileId of
  Just profileId
    | isNothing (mineOf model post.noteId) && not (busy model post.noteId) && emoji.available ->
        let
          -- Re-reacting while the removal is unsent: PUT replaces it on the server, so
          -- the removal is not sent now; it stays with the request and is sent after
          -- all if the PUT fails (the user's removal is never lost).
          replacing = case model.reaction.pendingRemoval of
            Just removal | removal.post.noteId == post.noteId -> Just removal
            _ -> Nothing
          Tuple cancelled cancelEffects = case replacing of
            Just _ -> cancelPending (withReaction model _ { toast = Nothing })
            Nothing -> Tuple model []
          Tuple numbered request = nextRequest cancelled
          next = withReaction numbered \reaction -> reaction
            { posts = setMine post.noteId (Just emoji) reaction.posts
            , picker = Nothing
            }
        in
          enqueueNote false
            { profileId, epoch: model.reaction.epoch, request, post, mine: Just emoji, removal: replacing, started: false }
            next
            # andThen \queued -> Tuple queued (cancelEffects <> [ effect (focusPost post (mineChipId post.postId) false) ])
  _ -> Tuple model []

-- | My chip pressed: removed on screen now, DELETE when the undo opportunity ends.
removeMine :: PostRef -> Model -> Step
removeMine post model = case model.reaction.profileId, mineOf model post.noteId of
  Just profileId, Just emoji
    | not (busy model post.noteId) ->
        let
          removal = { profileId, post, emoji }
        in
          -- An earlier undo toast is replaced: its removal is confirmed first.
          setToast (Just (UndoRemoval removal)) (withReaction model \reaction -> reaction { posts = setMine post.noteId Nothing reaction.posts })
            # andThen \shown ->
                Tuple (withReaction shown _ { pendingRemoval = Just removal })
                  [ effect (setPendingRemoval profileId post.noteId), effect (focusPost post (reactionButtonOf post.postId) false) ]
  _, _ -> Tuple model []

-- Favourites ---------------------------------------------------------------------------

-- | Settings use a Profile-wide lane. On returning to a Profile with a save in
-- | flight, its editor waits for completion and a fresh revision before reopening.
settingsBusy :: Model -> String -> Boolean
settingsBusy model profileId = any (\write -> write.profileId == profileId) model.reactionWrites.settings

requestSettings :: Boolean -> Boolean -> Model -> Step
requestSettings retry showLoading model = case model.reaction.profileId of
  Just profileId | not (settingsBusy model profileId) && not model.reaction.restoring ->
    let
      Tuple numbered request = nextRequest model
    in
      Tuple
        ( withReaction numbered _
            { settings = if showLoading then Loading else model.reaction.settings
            , settingsRequest = request
            , savingSettings = retry || model.reaction.savingSettings
            , retryAfterLoad = retry
            }
        )
        [ send (SettingsLoaded model.reaction.epoch request) (fetchQuickSettings profileId) ]
  _ -> Tuple model []

saveFavorites :: Array Emoji -> String -> Model -> Step
saveFavorites favorites focusId model = case model.reaction.profileId, model.reaction.settings of
  Just profileId, Loaded settings
    | not model.reaction.savingSettings && not model.reaction.restoring && not (settingsBusy model profileId) && length favorites <= maxFavorites ->
        let
          Tuple numbered request = nextRequest model
          registered = numbered
            { reactionWrites = numbered.reactionWrites
                { settings = snoc numbered.reactionWrites.settings { profileId, epoch: model.reaction.epoch, request } }
            }
        in
          Tuple
            ( withReaction registered _
                { settings = Loaded settings { favorites = favorites }
                , savingSettings = true
                , settingsProblem = Nothing
                , settingsRequest = request
                }
            )
            [ effect (focusById focusId)
            , send (SettingsSaved model.reaction.epoch request settings favorites) (saveQuickSettings profileId settings.revision favorites)
            ]
  _, _ -> Tuple model []

favoritesOf :: Model -> Maybe (Array Emoji)
favoritesOf model = case model.reaction.settings of
  Loaded settings -> Just settings.favorites
  _ -> Nothing

canEditFavorites :: Model -> Boolean
canEditFavorites model = isJust (favoritesOf model) && not model.reaction.savingSettings && not model.reaction.restoring

dropFavoriteUndo :: Model -> Model
dropFavoriteUndo model = case model.reaction.toast of
  Just { kind: UndoFavoriteRemoval _ _ } -> withReaction model _ { toast = Nothing }
  Just { kind: FavoriteRemoved _ } -> withReaction model _ { toast = Nothing }
  _ -> model

settingsAnswer :: Model -> Int -> Int -> Boolean
settingsAnswer model epoch request = epoch == model.reaction.epoch && request == model.reaction.settingsRequest && not model.reaction.restoring

-- Update -------------------------------------------------------------------------------

update :: Model -> ReactionMsg -> Step
update model = case _ of
  SettingsLoaded epoch request result
    | settingsAnswer model epoch request ->
        let
          loaded = withReaction model _ { settings = fromEither result, savingSettings = false, retryAfterLoad = false }
        in
          case result, model.reaction.settingsProblem of
            Right _, Just { retry: Just intended } | model.reaction.retryAfterLoad -> saveFavorites intended favoriteAddId loaded
            _, _ -> Tuple loaded []
    | otherwise -> Tuple model []

  PostReactionsLoaded epoch reads result
    | epoch == model.reaction.epoch && not model.reaction.restoring -> case result of
        Right fetched ->
          let
            posts = mergePosts model reads fetched
            restored = nub
              ( map (\post -> { postId: post.id, noteId: post.noteId })
                  ( filter
                      (\post -> isNothing (mineOf model post.noteId) && isJust (postReactionsFor posts post.noteId >>= _.mine))
                      (shownPosts model)
                  )
              )
            next = withReaction model \reaction -> foldl (\state post -> closePickerOf post.postId state)
              (reaction { posts = posts, postsError = Nothing })
              restored
            restoreFocus post = effect (focusPost post (mineChipId post.postId) true)
          in
            Tuple next (map restoreFocus restored)
        Left error | any (readable model) reads -> Tuple (withReaction model _ { postsError = Just error }) []
        _ -> Tuple model []
    | otherwise -> Tuple model []

  CustomEmojisLoaded result -> Tuple (withReaction model _ { customEmojis = fromEither result }) []

  OpenPicker target opener -> case model.reaction.picker of
    Just open | open.target == target -> closePicker model
    _
      | allowed target ->
          let
            next = withReaction model _ { picker = Just { target, query: "", category: "face", opener }, chipMenu = Nothing }
          in
            Tuple next [ effect (focusPicker target (if model.isMobile then pickerId else pickerSearchId) false) ]
      | otherwise -> Tuple model []
    where
    allowed = case _ of
      ReactTo post -> isNothing (mineOf model post.noteId) && not (busy model post.noteId) && isJust model.reaction.profileId
      AddFavorite -> canEditFavorites model && maybe false (\list -> length list < maxFavorites) (favoritesOf model)
      ReplaceFavorite _ -> canEditFavorites model

  ClosePicker -> closePicker model

  PickerSearch query -> case model.reaction.picker of
    Just picker -> Tuple (withReaction model _ { picker = Just picker { query = query } }) []
    Nothing -> Tuple model []

  PickerCategory category -> selectCategory model category false

  Pick emoji -> case model.reaction.picker of
    Just { target: ReactTo post } -> react post emoji model
    Just { target: AddFavorite } -> case favoritesOf model of
      Just list
        | not (any (sameEmoji emoji) list) && length list < maxFavorites ->
            let
              added = snoc list emoji
              focusId = if length added < maxFavorites then favoriteAddId else favoriteChipId (length added - 1)
            in
              saveFavorites added focusId (withReaction model _ { picker = Nothing })
      _ -> Tuple model []
    Just { target: ReplaceFavorite at } -> case favoritesOf model of
      Just list
        | not (any (sameEmoji emoji) list) ->
            saveFavorites (replaceAt at emoji list) (favoriteChipId at) (withReaction model _ { picker = Nothing })
      _ -> Tuple model []
    Nothing -> Tuple model []

  -- P2: not selectable; say why and offer the way to replace it.
  PickUnavailableFavorite emoji -> setToast (Just (FavoriteUnavailable emoji)) model

  ReactWithChip post emoji -> react post emoji model

  RemoveMine post -> removeMine post model

  ReactionSaved epoch request post _ result -> case noteAnswer model epoch request post.noteId of
    Nothing -> Tuple model []
    Just write ->
      Tuple (settleNote write model) []
        # andThen
            ( \settled ->
                if not (visibleWrite settled write) then Tuple settled []
                else case result of
                  Right mine -> Tuple (withReaction settled \reaction -> reaction { posts = setMine post.noteId mine reaction.posts }) []
                  Left error ->
                    setToast (Just (ReactionFailed "リアクションできませんでした" error))
                      (withReaction settled \reaction -> reaction { posts = setMine post.noteId Nothing reaction.posts })
                      # andThen \next -> Tuple next [ effect (focusPost post (reactionButtonOf post.postId) true) ]
            )
        -- Cleanup is transport, not presentation: it runs even if A changed to B,
        -- and before A's next queued intent. Never send it as the acting Profile B.
        # andThen
            ( \next -> case result, write.removal of
                Left _, Just removal -> queueRemoval true write.epoch removal next
                _, _ -> Tuple next []
            )
        # andThen (finishNote write)
        # andThen
            ( \next -> case result of
                -- After A -> B -> A an earlier PUT may already have succeeded.
                -- Without a replaced removal there is no DELETE cleanup, so a
                -- failed queued PUT must revalidate rather than assume no reaction.
                Left _ | visibleWrite next write && isNothing write.removal ->
                  Tuple next (loadPosts next.reaction.epoch write.profileId [ post.noteId ] next)
                _ -> Tuple next []
            )

  RemovalSent epoch request removal result -> case noteAnswer model epoch request removal.post.noteId of
    Nothing -> Tuple model []
    Just write ->
      Tuple (settleNote write model) []
        # andThen
            ( \settled ->
                if not (visibleWrite settled write) then Tuple settled []
                else case result of
                  Right _ -> Tuple settled []
                  Left error ->
                    setToast (Just (ReactionFailed "リアクションを取り消せませんでした" error))
                      (withReaction settled \reaction -> closePickerOf removal.post.postId reaction { posts = setMine removal.post.noteId (Just removal.emoji) reaction.posts })
                      # andThen \next -> Tuple next [ effect (focusPost removal.post (mineChipId removal.post.postId) true) ]
            )
        # andThen (finishNote write)

  ToastExpired id generation -> case model.reaction.toast of
    Just toast | toast.id == id && toast.armed == generation && not (held toast.holds) -> case toast.kind of
      -- The deletion is still being saved: its undo cannot run yet, so keep it.
      UndoFavoriteRemoval _ _ | model.reaction.savingSettings ->
        let
          rearmed = model.reaction.toastSeq + 1
        in
          Tuple (withReaction model _ { toast = Just toast { armed = rearmed }, toastSeq = rearmed }) [ expireAfter 3000.0 toast.id rearmed ]
      _ -> setToast Nothing model
    _ -> Tuple model []

  ToastHold reason on -> case model.reaction.toast of
    Just toast ->
      let
        holds = case reason of
          HoldHover -> toast.holds { hover = on }
          HoldTouch -> toast.holds { touch = on }
          HoldFocus -> toast.holds { focus = on }
        released = held toast.holds && not (held holds)
        rearmed = model.reaction.toastSeq + 1
      in
        if released then
          Tuple (withReaction model _ { toast = Just toast { holds = holds, armed = rearmed }, toastSeq = rearmed }) [ expireAfter 3000.0 toast.id rearmed ]
        else Tuple (withReaction model _ { toast = Just toast { holds = holds } }) []
    Nothing -> Tuple model []

  ToastUndo -> case model.reaction.toast of
    -- C2 / 注意 1: back to reacted (a restore, not a replacement), close the picker of
    -- any post, focus my chip. Nothing is sent.
    Just { kind: UndoRemoval removal }
      | map (_.post.noteId) model.reaction.pendingRemoval == Just removal.post.noteId ->
          cancelPending
            ( withReaction model \reaction -> reaction
                { posts = setMine removal.post.noteId (Just removal.emoji) reaction.posts
                , toast = Nothing
                , picker = Nothing
                }
            )
            # andThen \next -> Tuple next [ effect (focusPost removal.post (mineChipId removal.post.postId) false) ]
    -- S2: while the deletion is still being saved the undo waits (the button is
    -- disabled and the toast stays).
    Just { kind: UndoFavoriteRemoval _ _ } | model.reaction.savingSettings -> Tuple model []
    Just { kind: UndoFavoriteRemoval at emoji } -> case favoritesOf model of
      Just list
        | not (any (sameEmoji emoji) list) && length list < maxFavorites ->
            saveFavorites (fromMaybe (snoc list emoji) (insertAt at emoji list)) (favoriteChipId at)
              (withReaction model _ { toast = Nothing })
      _ -> Tuple (withReaction model _ { toast = Nothing }) []
    _ -> setToast Nothing model

  -- P2 「入れ替える」: to the favourites setting.
  ToastAction -> setToast Nothing (withReaction model _ { picker = Nothing }) # andThen \next -> Tuple next [ pure (Just (Navigate Settings)) ]

  ToggleChipMenu at
    | model.reaction.chipMenu == Just at ->
        Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId at)) ]
    | canEditFavorites model ->
        Tuple (withReaction model _ { chipMenu = Just at, picker = Nothing }) [ effect (focusFirstIn ("#" <> chipMenuId)) ]
    | otherwise -> Tuple model []

  CloseChipMenu -> case model.reaction.chipMenu of
    Just at -> Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId at)) ]
    Nothing -> Tuple model []

  MoveFavorite from to -> case favoritesOf model of
    Just list | from /= to && to >= 0 && to < length list ->
      saveFavorites (moveItem from to list) (favoriteChipId to) (withReaction model _ { chipMenu = Nothing, dragFrom = Nothing })
    _ -> Tuple (withReaction model _ { chipMenu = Nothing, dragFrom = Nothing }) []

  -- S2: deleted at once with an undo toast. Exception: an unavailable favourite cannot
  -- be added back (S3 answers 422), so its toast has no 元に戻す (lead decision).
  RemoveFavorite at -> case favoritesOf model of
    Just list | Just emoji <- index list at ->
      saveFavorites (removeAt at list) favoriteAddId (withReaction model _ { chipMenu = Nothing })
        # andThen \saved ->
            if saved.reaction.savingSettings then setToast (Just (if emoji.available then UndoFavoriteRemoval at emoji else FavoriteRemoved emoji)) saved
            else Tuple saved []
    _ -> Tuple model []

  StartReplaceFavorite at ->
    update (withReaction model _ { chipMenu = Nothing }) (OpenPicker (ReplaceFavorite at) (favoriteChipId at))

  SettingsSaved epoch request previous intended result ->
    case
      find
        (\write -> write.profileId == previous.profileId && write.epoch == epoch && write.request == request)
        model.reactionWrites.settings
      of
      Nothing -> Tuple model []
      Just write ->
        let
          settled = model
            { reactionWrites = model.reactionWrites
                { settings = filter (\entry -> entry.request /= request) model.reactionWrites.settings }
            }
        in
          if not (settingsAnswer model epoch request) then
            if Just write.profileId == model.reaction.profileId then
              requestSettings false true (withReaction settled _ { savingSettings = false })
            else Tuple settled []
          else case result of
            Right settings -> Tuple (withReaction settled _ { settings = Loaded settings, savingSettings = false }) []
            -- 409: first show the stored list/revision, retaining the intended list.
            Left error@(RevisionConflict _) ->
              requestSettings false false
                (withReaction (dropFavoriteUndo settled) _ { settings = Loaded previous, settingsProblem = Just { error, retry: Just intended } })
            Left error@(EmojiUnavailable _) ->
              Tuple (withReaction (dropFavoriteUndo settled) _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Nothing } }) []
            -- 422: an external emoji is never a favourite; retrying cannot succeed.
            Left error@(EmojiUsageNotAllowed _) ->
              Tuple (withReaction (dropFavoriteUndo settled) _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Nothing } }) []
            Left error ->
              Tuple (withReaction (dropFavoriteUndo settled) _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Just intended } }) []

  RetrySettings
    | model.reaction.savingSettings || model.reaction.restoring -> Tuple model []
    | otherwise -> case model.reaction.settingsProblem of
        Just { retry: Just intended } -> case model.reaction.settings of
          Loaded _ -> saveFavorites intended favoriteAddId model
          -- The conflict's GET may itself fail. Retry must obtain a revision and
          -- then save, rather than silently calling saveFavorites on Failed.
          _ -> requestSettings true true model
        _ -> Tuple model []

  DragStart at -> Tuple (withReaction model _ { dragFrom = Just at, chipMenu = Nothing }) []

  DragDrop at -> case model.reaction.dragFrom of
    Just from -> update model (MoveFavorite from at)
    Nothing -> Tuple model []

  DragEnd -> Tuple (withReaction model _ { dragFrom = Nothing }) []

  -- D1: pressing the selected one again closes the list.
  SelectDetailFilter wanted ->
    Tuple (withReaction model _ { detailFilter = if model.reaction.detailFilter == wanted then ListClosed else wanted }) []

  -- pageshow starts synchronously: undo ends and interaction stops immediately.
  -- No GET or mutation resumes until the pagehide keepalive Promise has settled.
  PageRestoring ->
    Tuple
      ( withReaction model _
          { pendingRemoval = Nothing
          , toast = Nothing
          , picker = Nothing
          , chipMenu = Nothing
          , restoring = true
          , epoch = model.reaction.epoch + 1
          }
      )
      [ effect clearPendingRemoval ]

  PageRestored ->
    restart model.reaction.profileId (withReaction model _ { pendingRemoval = Nothing, toast = Nothing, picker = Nothing, chipMenu = Nothing, restoring = false })
      # andThen \next -> Tuple next [ effect clearPendingRemoval ]
