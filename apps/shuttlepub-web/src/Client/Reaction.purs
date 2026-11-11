-- | Update of the quick reaction UI (D03). Client.Update delegates `Reaction` messages
-- | here and calls the hooks (Profile change, posts shown, navigation, Esc) at the
-- | points the shell owns.
-- |
-- | Rules from ui-spec v6 (host intents/shuttlepub/features/quick-reaction-ui):
-- |  - 1 Profile, 1 post, 1 reaction; no replacement from the picker (C1, D03 q06).
-- |  - Whenever a post becomes reacted (pick, someone's chip, undo) every UI anchored
-- |    on its reaction button closes and focus goes to my chip; after removal focus
-- |    goes to the reaction button (実装上の注意 1, 2, 6).
-- |  - Removal is shown at once; DELETE is sent when the undo toast goes away (or on
-- |    navigation / page hide); undo sends nothing (D03 q09).
-- |  - Requests carry the acting Profile; answers for another Profile are dropped and
-- |    a Profile change resets everything (no mixing of Profiles).
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
import App.Reaction (DetailFilter(..), PendingRemoval, PickerTarget(..), PostReactions, PostRef, ReactionMsg(..), ToastKind(..), maxFavorites, moveItem, postReactionsFor, removeAt, replaceAt)
import App.ReactionDom (clearPendingRemoval, setPendingRemoval)
import App.Route (Route(..))
import Data.Array (any, cons, delete, elem, filter, index, insertAt, length, nub, null, snoc)
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

-- | Undo toast keeps 6s, a plain one 3s; after the pointer / focus leaves, 3s (注意 3).
toastLifetime :: ToastKind -> Number
toastLifetime = case _ of
  ReactionFailed _ _ -> 3000.0
  _ -> 6000.0

showToast :: ToastKind -> Model -> Step
showToast kind model =
  let
    id = model.reaction.toastSeq + 1
    next = withReaction model _ { toast = Just { id, kind, held: false, armed: id }, toastSeq = id }
  in
    Tuple next [ expireAfter (toastLifetime kind) id id ]

expireAfter :: Number -> Int -> Int -> Aff (Maybe Message)
expireAfter ms id generation = delay (Milliseconds ms) $> Just (Reaction (ToastExpired id generation))

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

-- | Profile context loaded or switched: if the acting Profile changed, send the
-- | pending removal of the previous one, drop everything of it and load the new one.
syncProfile :: Model -> Step
syncProfile model
  | map _.id (activeProfile model) == model.reaction.profileId = Tuple model []
  | otherwise =
      let
        newId = map _.id (activeProfile model)
        commit = maybe [] (\removal -> [ sendRemoval removal ]) model.reaction.pendingRemoval
        fresh = initialReactionModel
          { profileId = newId
          , settings = if isJust newId then Loading else NotAsked
          , customEmojis = model.reaction.customEmojis
          , toastSeq = model.reaction.toastSeq
          }
        next = model { reaction = fresh }
        loads = case newId of
          Just profileId ->
            [ send (SettingsLoaded profileId) (fetchQuickSettings profileId) ]
              <> loadPosts profileId (shownNoteIds model)
              <> if model.reaction.customEmojis == NotAsked then [ send CustomEmojisLoaded fetchCustomEmojis ] else []
          Nothing -> []
      in
        Tuple
          (if model.reaction.customEmojis == NotAsked && isJust newId then withReaction next _ { customEmojis = Loading } else next)
          ([ effect clearPendingRemoval ] <> commit <> loads)

loadPosts :: String -> Array String -> Effects
loadPosts profileId noteIds
  | null noteIds = []
  | otherwise = [ send (PostReactionsLoaded profileId) (fetchPostReactions profileId noteIds) ]

-- | Posts appeared (timeline / detail loaded): load their reactions for the acting Profile.
postsShown :: Array Post -> Model -> Step
postsShown posts model = case model.reaction.profileId of
  Just profileId -> Tuple model (loadPosts profileId (map _.noteId posts))
  Nothing -> Tuple model []

-- | Navigation confirms a pending removal at once (D03 q09) and closes every layer.
leaveScreen :: Model -> Step
leaveScreen model =
  let
    reaction = model.reaction
    commit = maybe [] (\removal -> [ effect clearPendingRemoval, sendRemoval removal ]) reaction.pendingRemoval
    toast = case reaction.toast of
      Just { kind: UndoRemoval _ } -> Nothing
      other -> other
  in
    Tuple
      (withReaction model _ { pendingRemoval = Nothing, toast = toast, picker = Nothing, chipMenu = Nothing, dragFrom = Nothing, detailFilter = AllReactors })
      commit

-- | D1: the reactions tab opens on 「すべて」.
detailReactionsOpened :: Model -> Model
detailReactionsOpened model = withReaction model _ { detailFilter = AllReactors }

-- | Esc: the picker, then a favourite's menu. Nothing when neither is open.
escape :: Model -> Maybe Step
escape model
  | isJust model.reaction.picker = Just (closePicker model)
  | Just index <- model.reaction.chipMenu = Just (Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId index)) ])
  | otherwise = Nothing

-- | Modal layers lock the page scroll: the picker as a bottom sheet (mobile) or as
-- | the favourites dialog, and a favourite's menu sheet (mobile).
pickerLocksScroll :: Model -> Boolean
pickerLocksScroll model = case model.reaction.picker of
  Just picker -> model.isMobile || not (isReact picker.target)
  Nothing -> model.isMobile && isJust model.reaction.chipMenu
  where
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

mineOf :: Model -> String -> Maybe Emoji
mineOf model noteId = postReactionsFor model.reaction.posts noteId >>= _.mine

busy :: Model -> String -> Boolean
busy model noteId = elem noteId model.reaction.inFlight

setMine :: String -> Maybe Emoji -> Array PostReactions -> Array PostReactions
setMine noteId mine posts
  | any (\entry -> entry.noteId == noteId) posts = map (\entry -> if entry.noteId == noteId then entry { mine = mine } else entry) posts
  | otherwise = snoc posts { noteId, mine, others: [] }

-- | Keeps local truth for notes with an unsent removal or a request in flight.
mergePosts :: ReactionModel -> Array PostReactions -> Array PostReactions
mergePosts reaction fetched =
  map keepLocal fetched <> filter (\entry -> not (any (\new -> new.noteId == entry.noteId) fetched)) reaction.posts
  where
  local noteId = elem noteId reaction.inFlight || map (_.post.noteId) reaction.pendingRemoval == Just noteId
  keepLocal entry
    | local entry.noteId = entry { mine = postReactionsFor reaction.posts entry.noteId >>= _.mine }
    | otherwise = entry

sendRemoval :: PendingRemoval -> Aff (Maybe Message)
sendRemoval removal = send (RemovalSent removal) (removeNoteReaction removal.profileId removal.post.noteId)

-- | Become reacted (picker / someone's chip): optimistic, one request at a time.
react :: PostRef -> Emoji -> Model -> Step
react post emoji model = case model.reaction.profileId of
  Just profileId
    | isNothing (mineOf model post.noteId) && not (busy model post.noteId) && emoji.available ->
        let
          reaction = model.reaction
          -- Re-reacting while the removal is unsent: PUT replaces it, nothing to send.
          cancelled = map (_.post.noteId) reaction.pendingRemoval == Just post.noteId
          toast = case reaction.toast of
            Just { kind: UndoRemoval removal } | removal.post.noteId == post.noteId -> Nothing
            other -> other
          next = withReaction model _
            { posts = setMine post.noteId (Just emoji) reaction.posts
            , inFlight = cons post.noteId reaction.inFlight
            , picker = Nothing
            , pendingRemoval = if cancelled then Nothing else reaction.pendingRemoval
            , toast = toast
            }
        in
          Tuple next
            ( (if cancelled then [ effect clearPendingRemoval ] else [])
                <>
                  [ effect (focusById (mineChipId post.postId))
                  , send (ReactionSaved profileId post Nothing) (setNoteReaction profileId post.noteId emoji)
                  ]
            )
  _ -> Tuple model []

-- | My chip pressed: removed on screen now, DELETE when the undo toast goes away.
removeMine :: PostRef -> Model -> Step
removeMine post model = case model.reaction.profileId, mineOf model post.noteId of
  Just profileId, Just emoji
    | not (busy model post.noteId) ->
        let
          removal = { profileId, post, emoji }
          earlier = maybe [] (\pending -> [ sendRemoval pending ]) model.reaction.pendingRemoval
          base = withReaction model _ { posts = setMine post.noteId Nothing model.reaction.posts, pendingRemoval = Just removal }
          Tuple next effects = showToast (UndoRemoval removal) base
        in
          Tuple next
            (earlier <> [ effect (setPendingRemoval profileId post.noteId), effect (focusById (reactionButtonOf post.postId)) ] <> effects)
  _, _ -> Tuple model []

-- | Settings are saved operation by operation (S2), never two at once.
saveFavorites :: Array Emoji -> String -> Model -> Step
saveFavorites favorites focusId model = case model.reaction.profileId, model.reaction.settings of
  Just profileId, Loaded settings
    | not model.reaction.savingSettings && length favorites <= maxFavorites ->
        Tuple
          (withReaction model _ { settings = Loaded settings { favorites = favorites }, savingSettings = true, settingsProblem = Nothing })
          [ effect (focusById focusId)
          , send (SettingsSaved profileId settings favorites) (saveQuickSettings profileId settings.revision favorites)
          ]
  _, _ -> Tuple model []

favoritesOf :: Model -> Maybe (Array Emoji)
favoritesOf model = case model.reaction.settings of
  Loaded settings -> Just settings.favorites
  _ -> Nothing

canEditFavorites :: Model -> Boolean
canEditFavorites model = isJust (favoritesOf model) && not model.reaction.savingSettings

update :: Model -> ReactionMsg -> Step
update model = case _ of
  SettingsLoaded profileId result
    | Just profileId == model.reaction.profileId ->
        Tuple (withReaction model _ { settings = fromEither result, savingSettings = false }) []
    | otherwise -> Tuple model []

  PostReactionsLoaded profileId result
    | Just profileId == model.reaction.profileId -> case result of
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
    Just { target: ReplaceFavorite index } -> case favoritesOf model of
      Just list
        | not (any (sameEmoji emoji) list) ->
            saveFavorites (replaceAt index emoji list) (favoriteChipId index) (withReaction model _ { picker = Nothing })
      _ -> Tuple model []
    Nothing -> Tuple model []

  -- P2: not selectable; say why and offer the way to replace it.
  PickUnavailableFavorite emoji -> showToast (FavoriteUnavailable emoji) model

  ReactWithChip post emoji -> react post emoji model

  RemoveMine post -> removeMine post model

  ReactionSaved profileId post previous result
    | Just profileId /= model.reaction.profileId -> Tuple model []
    | otherwise ->
        let
          settled = withReaction model \reaction -> reaction { inFlight = delete post.noteId reaction.inFlight }
        in
          case result of
            Right mine -> Tuple (withReaction settled \reaction -> reaction { posts = setMine post.noteId mine reaction.posts }) []
            Left error ->
              let
                reverted = withReaction settled \reaction -> reaction { posts = setMine post.noteId previous reaction.posts }
                Tuple next effects = showToast (ReactionFailed "リアクションできませんでした" error) reverted
              in
                Tuple next (effects <> [ effect (focusById (reactionButtonOf post.postId)) ])

  RemovalSent removal result -> case result of
    Right _ -> Tuple model []
    Left error
      | Just removal.profileId == model.reaction.profileId
          && isNothing (mineOf model removal.post.noteId)
          && not (busy model removal.post.noteId) ->
          showToast (ReactionFailed "リアクションを取り消せませんでした" error)
            (withReaction model \reaction -> reaction { posts = setMine removal.post.noteId (Just removal.emoji) reaction.posts })
      | otherwise -> showToast (ReactionFailed "リアクションを取り消せませんでした" error) model

  ToastExpired id generation -> case model.reaction.toast of
    Just toast | toast.id == id && toast.armed == generation && not toast.held ->
      let
        cleared = withReaction model _ { toast = Nothing }
      in
        case toast.kind of
          UndoRemoval removal | map (_.post.noteId) model.reaction.pendingRemoval == Just removal.post.noteId ->
            Tuple (withReaction cleared _ { pendingRemoval = Nothing }) [ effect clearPendingRemoval, sendRemoval removal ]
          _ -> Tuple cleared []
    _ -> Tuple model []

  ToastHold held -> case model.reaction.toast of
    Just toast
      | held -> Tuple (withReaction model _ { toast = Just toast { held = true } }) []
      | toast.held ->
          let
            generation = model.reaction.toastSeq + 1
          in
            Tuple (withReaction model _ { toast = Just toast { held = false, armed = generation }, toastSeq = generation })
              [ expireAfter 3000.0 toast.id generation ]
    _ -> Tuple model []

  ToastUndo -> case model.reaction.toast of
    -- C2 / 注意 1: back to reacted (a restore, not a replacement), close the picker of
    -- any post, focus my chip.
    Just { kind: UndoRemoval removal }
      | Just removal.profileId == model.reaction.profileId
          && map (_.post.noteId) model.reaction.pendingRemoval == Just removal.post.noteId ->
          Tuple
            ( withReaction model \reaction -> reaction
                { posts = setMine removal.post.noteId (Just removal.emoji) reaction.posts
                , pendingRemoval = Nothing
                , toast = Nothing
                , picker = Nothing
                }
            )
            [ effect clearPendingRemoval, effect (focusById (mineChipId removal.post.postId)) ]
    Just { kind: UndoFavoriteRemoval index emoji } -> case favoritesOf model of
      Just list
        | not (any (sameEmoji emoji) list) && length list < maxFavorites ->
            saveFavorites (fromMaybe (snoc list emoji) (insertAt index emoji list)) (favoriteChipId index)
              (withReaction model _ { toast = Nothing })
      _ -> Tuple (withReaction model _ { toast = Nothing }) []
    _ -> Tuple (withReaction model _ { toast = Nothing }) []

  -- P2 「入れ替える」: to the favourites setting.
  ToastAction -> Tuple (withReaction model _ { toast = Nothing, picker = Nothing }) [ pure (Just (Navigate Settings)) ]

  ToggleChipMenu index
    | model.reaction.chipMenu == Just index ->
        Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId index)) ]
    | canEditFavorites model ->
        Tuple (withReaction model _ { chipMenu = Just index, picker = Nothing }) [ effect (focusFirstIn ("#" <> chipMenuId)) ]
    | otherwise -> Tuple model []

  CloseChipMenu -> case model.reaction.chipMenu of
    Just index -> Tuple (withReaction model _ { chipMenu = Nothing }) [ effect (focusById (favoriteChipId index)) ]
    Nothing -> Tuple model []

  MoveFavorite from to -> case favoritesOf model of
    Just list | from /= to && to >= 0 && to < length list ->
      saveFavorites (moveItem from to list) (favoriteChipId to) (withReaction model _ { chipMenu = Nothing, dragFrom = Nothing })
    _ -> Tuple (withReaction model _ { chipMenu = Nothing, dragFrom = Nothing }) []

  -- S2: deleted at once with an undo toast.
  RemoveFavorite index -> case favoritesOf model of
    Just list | Just emoji <- findAt index list ->
      let
        Tuple saved effects = saveFavorites (removeAt index list) favoriteAddId (withReaction model _ { chipMenu = Nothing })
        Tuple next toastEffects = if saved.reaction.savingSettings then showToast (UndoFavoriteRemoval index emoji) saved else Tuple saved []
      in
        Tuple next (effects <> toastEffects)
    _ -> Tuple model []

  StartReplaceFavorite index ->
    update (withReaction model _ { chipMenu = Nothing }) (OpenPicker (ReplaceFavorite index) (favoriteChipId index))

  SettingsSaved profileId previous intended result
    | Just profileId /= model.reaction.profileId -> Tuple model []
    | otherwise -> case result of
        Right settings -> Tuple (withReaction model _ { settings = Loaded settings, savingSettings = false }) []
        -- 409: another device saved first. Show the stored list and offer to send ours again.
        Left error@(RevisionConflict _) ->
          Tuple
            (withReaction model _ { settings = Loaded previous, settingsProblem = Just { error, retry: Just intended } })
            [ send (SettingsLoaded profileId) (fetchQuickSettings profileId) ]
        Left error@(EmojiUnavailable _) ->
          Tuple (withReaction model _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Nothing } }) []
        Left error ->
          Tuple (withReaction model _ { settings = Loaded previous, savingSettings = false, settingsProblem = Just { error, retry: Just intended } }) []

  RetrySettings -> case model.reaction.settingsProblem of
    Just { retry: Just intended } -> saveFavorites intended favoriteAddId model
    _ -> Tuple model []

  DragStart index -> Tuple (withReaction model _ { dragFrom = Just index, chipMenu = Nothing }) []

  DragDrop index -> case model.reaction.dragFrom of
    Just from -> update model (MoveFavorite from index)
    Nothing -> Tuple model []

  DragEnd -> Tuple (withReaction model _ { dragFrom = Nothing }) []

  -- D1: pressing the selected one again closes the list.
  SelectDetailFilter wanted ->
    Tuple (withReaction model _ { detailFilter = if model.reaction.detailFilter == wanted then ListClosed else wanted }) []

findAt :: forall a. Int -> Array a -> Maybe a
findAt at list = index list at
