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
-- |  - One request per Note at a time, PUT and DELETE alike (inFlight); one settings
-- |    request at a time (savingSettings). Fetched state never overwrites a Note that
-- |    has an unsent removal or a request in flight.
-- |  - Requests carry the Profile context generation (epoch) and a request id; answers
-- |    of another generation or an older request are dropped. A Profile change (also
-- |    A -> B -> A) or a restore from the back/forward cache starts a new generation.
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
import App.Dom (focusById, focusFirstIn)
import App.Emoji (Emoji, sameEmoji)
import App.Extension.Reaction (chipMenuId, favoriteAddId, favoriteChipId, mineChipId, pickerId, pickerSearchId, pickerTabId)
import App.Message (Message(..))
import App.Model (Model, ReactionModel, RemoteData(..), activeProfile, fromEither, initialReactionModel)
import App.Post (Post)
import App.Reaction (DetailFilter(..), HoldReason(..), PendingRemoval, PickerTarget(..), PostReactions, PostRef, ReactionMsg(..), ToastKind(..), held, maxFavorites, moveItem, noHolds, postReactionsFor, removeAt, replaceAt)
import App.ReactionDom (clearPendingRemoval, focusIfLost, setPendingRemoval)
import App.Route (Route(..))
import Data.Array (any, cons, filter, index, insertAt, length, nub, null, snoc)
import Data.Either (Either(..))
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

-- | DELETE, counted as the request in flight of its Note.
sendRemoval :: PendingRemoval -> Model -> Step
sendRemoval removal model =
  let
    Tuple numbered request = nextRequest model
  in
    Tuple (withReaction numbered \reaction -> reaction { inFlight = cons { noteId: removal.post.noteId, request } reaction.inFlight })
      [ send (RemovalSent model.reaction.epoch request removal) (removeNoteReaction removal.profileId removal.post.noteId) ]

-- | Undo / re-react: the removal is never sent.
cancelPending :: Model -> Step
cancelPending model = Tuple (withReaction model _ { pendingRemoval = Nothing }) [ effect clearPendingRemoval ]

-- Profile context --------------------------------------------------------------------

-- | Notes of the posts on screen (timeline, or the detail post and its replies).
shownNoteIds :: Model -> Array String
shownNoteIds model = nub (timeline <> detail)
  where
  timeline = case model.timeline of
    Loaded posts | model.route == Just Home -> map _.noteId posts
    _ -> []
  detail = case model.detail of
    Loaded { post: Just post, replies } -> map _.noteId (cons post replies)
    _ -> []

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
      , requestSeq = settingsRequest
      , settingsRequest = settingsRequest
      , settings = if isJust profileId then Loading else NotAsked
      , customEmojis = if needEmojis then Loading else reaction.customEmojis
      , toastSeq = reaction.toastSeq
      }
    loads = case profileId of
      Just id ->
        [ send (SettingsLoaded epoch settingsRequest) (fetchQuickSettings id) ]
          <> loadPosts epoch id (shownNoteIds model)
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

loadPosts :: Int -> String -> Array String -> Effects
loadPosts epoch profileId noteIds
  | null noteIds = []
  | otherwise = [ send (PostReactionsLoaded epoch) (fetchPostReactions profileId noteIds) ]

-- | Posts appeared (timeline / detail loaded): load their reactions for the acting Profile.
postsShown :: Array Post -> Model -> Step
postsShown posts model = case model.reaction.profileId of
  Just profileId -> Tuple model (loadPosts model.reaction.epoch profileId (map _.noteId posts))
  Nothing -> Tuple model []

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
refocusPicker model = if isJust model.reaction.picker then [ effect (focusFirstIn ("#" <> pickerId)) ] else []

selectCategory :: Model -> String -> Boolean -> Step
selectCategory model category moveFocus = case model.reaction.picker of
  Just picker ->
    Tuple (withReaction model _ { picker = Just picker { category = category, query = "" } })
      (if moveFocus then [ effect (focusById (pickerTabId category)) ] else [])
  Nothing -> Tuple model []

closePicker :: Model -> Step
closePicker model = case model.reaction.picker of
  Just picker -> Tuple (withReaction model _ { picker = Nothing }) [ effect (focusById picker.opener) ]
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

busy :: Model -> String -> Boolean
busy model noteId = any (\entry -> entry.noteId == noteId) model.reaction.inFlight

settle :: String -> Int -> ReactionModel -> ReactionModel
settle noteId request reaction = reaction { inFlight = filter (\entry -> not (entry.noteId == noteId && entry.request == request)) reaction.inFlight }

current :: Model -> Int -> String -> Int -> Boolean
current model epoch noteId request =
  epoch == model.reaction.epoch && any (\entry -> entry.noteId == noteId && entry.request == request) model.reaction.inFlight

setMine :: String -> Maybe Emoji -> Array PostReactions -> Array PostReactions
setMine noteId mine posts
  | any (\entry -> entry.noteId == noteId) posts = map (\entry -> if entry.noteId == noteId then entry { mine = mine } else entry) posts
  | otherwise = snoc posts { noteId, mine, others: [] }

-- | Keeps local truth for Notes with an unsent removal or a request in flight.
mergePosts :: ReactionModel -> Array PostReactions -> Array PostReactions
mergePosts reaction fetched =
  map keepLocal fetched <> filter (\entry -> not (any (\new -> new.noteId == entry.noteId) fetched)) reaction.posts
  where
  local noteId = any (\entry -> entry.noteId == noteId) reaction.inFlight || map (_.post.noteId) reaction.pendingRemoval == Just noteId
  keepLocal entry
    | local entry.noteId = entry { mine = postReactionsFor reaction.posts entry.noteId >>= _.mine }
    | otherwise = entry

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
            , inFlight = cons { noteId: post.noteId, request } reaction.inFlight
            , picker = Nothing
            }
        in
          Tuple next
            ( cancelEffects <>
                [ effect (focusById (mineChipId post.postId))
                , send (ReactionSaved model.reaction.epoch request post replacing) (setNoteReaction profileId post.noteId emoji)
                ]
            )
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
                  [ effect (setPendingRemoval profileId post.noteId), effect (focusById (reactionButtonOf post.postId)) ]
  _, _ -> Tuple model []

-- Favourites ---------------------------------------------------------------------------

-- | Settings are saved operation by operation (S2), never two at once.
saveFavorites :: Array Emoji -> String -> Model -> Step
saveFavorites favorites focusId model = case model.reaction.profileId, model.reaction.settings of
  Just profileId, Loaded settings
    | not model.reaction.savingSettings && length favorites <= maxFavorites ->
        let
          Tuple numbered request = nextRequest model
        in
          Tuple
            ( withReaction numbered _
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
canEditFavorites model = isJust (favoritesOf model) && not model.reaction.savingSettings

dropFavoriteUndo :: Model -> Model
dropFavoriteUndo model = case model.reaction.toast of
  Just { kind: UndoFavoriteRemoval _ _ } -> withReaction model _ { toast = Nothing }
  Just { kind: FavoriteRemoved _ } -> withReaction model _ { toast = Nothing }
  _ -> model

settingsAnswer :: Model -> Int -> Int -> Boolean
settingsAnswer model epoch request = epoch == model.reaction.epoch && request == model.reaction.settingsRequest

-- Update -------------------------------------------------------------------------------

update :: Model -> ReactionMsg -> Step
update model = case _ of
  SettingsLoaded epoch request result
    | settingsAnswer model epoch request ->
        Tuple (withReaction model _ { settings = fromEither result, savingSettings = false }) []
    | otherwise -> Tuple model []

  PostReactionsLoaded epoch result
    | epoch == model.reaction.epoch -> case result of
        Right fetched -> Tuple (withReaction model \reaction -> reaction { posts = mergePosts reaction fetched, postsError = Nothing }) []
        Left error -> Tuple (withReaction model _ { postsError = Just error }) []
    | otherwise -> Tuple model []

  CustomEmojisLoaded result -> Tuple (withReaction model _ { customEmojis = fromEither result }) []

  OpenPicker target opener -> case model.reaction.picker of
    Just open | open.target == target -> closePicker model
    _
      | allowed target ->
          let
            next = withReaction model _ { picker = Just { target, query: "", category: "face", opener }, chipMenu = Nothing }
          in
            Tuple next [ effect (focusById (if model.isMobile then pickerId else pickerSearchId)) ]
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

  ReactionSaved epoch request post replaced result
    | not (current model epoch post.noteId request) -> Tuple model []
    | otherwise ->
        let
          settled = withReaction model (settle post.noteId request)
        in
          case result of
            Right mine -> Tuple (withReaction settled \reaction -> reaction { posts = setMine post.noteId mine reaction.posts }) []
            -- Back to not reacted. If the PUT replaced an unsent removal, that removal is
            -- sent now: whatever the failed PUT did, the post ends without a reaction,
            -- as shown. Focus follows only if it was lost with the chip (注意 6).
            Left error ->
              setToast (Just (ReactionFailed "リアクションできませんでした" error))
                (withReaction settled \reaction -> reaction { posts = setMine post.noteId Nothing reaction.posts })
                # andThen (\next -> maybe (Tuple next []) (\removal -> sendRemoval removal next) replaced)
                # andThen \next -> Tuple next [ effect (focusIfLost (reactionButtonOf post.postId)) ]

  RemovalSent epoch request removal result
    | not (current model epoch removal.post.noteId request) -> case result of
        -- The Profile changed meanwhile: nothing to restore, but a failure is still shown.
        Left error | epoch /= model.reaction.epoch -> setToast (Just (ReactionFailed "リアクションを取り消せませんでした" error)) model
        _ -> Tuple model []
    | otherwise ->
        let
          settled = withReaction model (settle removal.post.noteId request)
        in
          case result of
            Right _ -> Tuple settled []
            -- The reaction is still there: show it again, close what was anchored on
            -- the reaction button and keep focus (注意 2 / 6).
            Left error ->
              setToast (Just (ReactionFailed "リアクションを取り消せませんでした" error))
                (withReaction settled \reaction -> closePickerOf removal.post.postId reaction { posts = setMine removal.post.noteId (Just removal.emoji) reaction.posts })
                # andThen \next -> Tuple next [ effect (focusIfLost (mineChipId removal.post.postId)) ]

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
            # andThen \next -> Tuple next [ effect (focusById (mineChipId removal.post.postId)) ]
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

  SettingsSaved epoch request previous intended result
    | not (settingsAnswer model epoch request) -> Tuple model []
    | otherwise -> case result of
        Right settings -> Tuple (withReaction model _ { settings = Loaded settings, savingSettings = false }) []
        -- A failed save also ends the undo of a deletion that did not happen.
        -- 409: another device saved first. Show the stored list and offer ours again.
        Left error@(RevisionConflict _) ->
          let
            Tuple numbered refetch = nextRequest (dropFavoriteUndo model)
          in
            Tuple
              (withReaction numbered _ { settings = Loaded previous, settingsProblem = Just { error, retry: Just intended }, settingsRequest = refetch })
              [ send (SettingsLoaded epoch refetch) (fetchQuickSettings previous.profileId) ]
        Left error@(EmojiUnavailable _) ->
          Tuple (withReaction (dropFavoriteUndo model) _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Nothing } }) []
        Left error ->
          Tuple (withReaction (dropFavoriteUndo model) _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Just intended } }) []

  RetrySettings -> case model.reaction.settingsProblem of
    Just { retry: Just intended } -> saveFavorites intended favoriteAddId model
    _ -> Tuple model []

  DragStart at -> Tuple (withReaction model _ { dragFrom = Just at, chipMenu = Nothing }) []

  DragDrop at -> case model.reaction.dragFrom of
    Just from -> update model (MoveFavorite from at)
    Nothing -> Tuple model []

  DragEnd -> Tuple (withReaction model _ { dragFrom = Nothing }) []

  -- D1: pressing the selected one again closes the list.
  SelectDetailFilter wanted ->
    Tuple (withReaction model _ { detailFilter = if model.reaction.detailFilter == wanted then ListClosed else wanted }) []

  -- Back from the back/forward cache: pagehide already handed the pending removal to
  -- keepalive (not confirmed), so its undo is over and nothing is resent. Every answer
  -- still in flight belongs to the old generation; read the screen again.
  PageRestored ->
    restart model.reaction.profileId (withReaction model _ { pendingRemoval = Nothing, toast = Nothing, picker = Nothing, chipMenu = Nothing })
      # andThen \next -> Tuple next [ effect clearPendingRemoval ]
