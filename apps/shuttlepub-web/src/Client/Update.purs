module Client.Update where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.GraphQL (createPost, fetchApiMode, fetchApiStatus, fetchAvailableProfiles, fetchPostDetail, fetchProfileContext, fetchTimeline, selectProfile)
import App.Dom (focusById, focusFirstIn, logoutAndReload, scrollToTop, setScrollLock)
import App.Message (Message(..))
import App.Model (DetailTab(..), Model, RemoteData(..), emptyCompose, fromEither)
import App.MuteBlock.Types as MuteBlock
import App.MuteBlock.Update as MuteBlockUpdate
import App.Post (TimelineTab, timelineTabFromValue)
import App.Route (Route(..), routeCodec)
import App.View.Compose (composeTextId, visibilityButtonId)
import App.View.Pages (detailTabId, timelineTabId)
import App.View.Shell (composeButtonDesktopId, composeButtonMobileId, profileButtonDesktopId, profileButtonMobileId, profileMenuId)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), isJust)
import Data.String.Common (trim)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Flame (Update, noMessages)
import Foreign (unsafeToForeign)
import Routing.Duplex (print)
import Routing.PushState (PushStateInterface)

-- | Hydrated is sent once right after resumeMount: it flips the hydration
-- | marker (the observable proof that the client took over from SSR) and starts
-- | the data requests. Responses, including failures, are stored as received.
mkUpdate :: PushStateInterface -> Update Model Message
mkUpdate nav model = case _ of
  Navigate route ->
    Tuple model
      [ liftEffect (nav.pushState (unsafeToForeign {}) (print routeCodec route)) $> Nothing ]
  UrlChanged route ->
    let
      closed = closeOverlays model
      entered = (closed.model { route = route }) `enterRoute` route
      Tuple muteBlock muteBlockEffects = enterMuteBlock entered.model
    in
      Tuple muteBlock (closed.effects <> [ effect scrollToTop ] <> entered.effects <> muteBlockEffects)
  Hydrated now isMobile ->
    let
      base = model
        { isHydrated = true
        , now = now
        , isMobile = isMobile
        , apiMode = Loading
        , apiStatus = Loading
        , profileContext = Loading
        , availableProfiles = Loading
        }
      entered = base `enterRoute` model.route
    in
      Tuple entered.model
        ( [ Just <<< ApiModeLoaded <$> fetchApiMode
          , Just <<< ApiStatusLoaded <$> fetchApiStatus
          , Just <<< ProfileContextLoaded <$> fetchProfileContext
          , Just <<< AvailableProfilesLoaded <$> fetchAvailableProfiles
          ] <> entered.effects
        )
  ViewportChanged isMobile ->
    let
      next = model { isMobile = isMobile }
      -- Crossing the breakpoint swaps the Profile dropdown for the bottom sheet (or
      -- back): the focused item is replaced, so move focus into the new menu.
      refocus = if isJust model.profileMenu && isMobile /= model.isMobile then [ effect (focusFirstIn ("#" <> profileMenuId)) ] else []
    in
      Tuple next ([ syncScrollLock next ] <> refocus)
  ApiModeLoaded result ->
    noMessages $ model { apiMode = fromEither result }
  ApiStatusLoaded result ->
    noMessages $ model { apiStatus = fromEither result }
  ProfileContextLoaded result ->
    enterMuteBlock (model { profileContext = fromEither result, muteBlock = model.muteBlock { profileKnown = false } })
  AvailableProfilesLoaded result ->
    noMessages $ model { availableProfiles = fromEither result }

  KeyPressed action -> case action.action of
    "escape" -> escape model
    "tab" -> case action.list of
      "timeline" | Just tab <- timelineTabFromValue action.value ->
        selectTimelineTab model tab true
      "detail" -> case action.value of
        "replies" -> selectDetailTab model RepliesTab true
        "reactions" -> selectDetailTab model ReactionsTab true
        _ -> noMessages model
      _ -> noMessages model
    _ -> noMessages model
  DocumentEscape -> escape model

  SelectTimelineTab tab -> selectTimelineTab model tab false
  TimelineLoaded tab result
    | tab == model.timelineTab -> noMessages $ model { timeline = fromEither result }
    | otherwise -> noMessages model
  PostDetailLoaded postId result
    | model.route == Just (PostDetail postId) -> noMessages $ model { detail = fromEither result }
    | otherwise -> noMessages model
  SelectDetailTab tab -> selectDetailTab model tab false

  OpenCompose opener ->
    let
      next = model { compose = Just (emptyCompose opener), profileMenu = Nothing }
    in
      Tuple next [ syncScrollLock next, effect (focusById composeTextId) ]
  CloseCompose -> closeCompose model
  ComposeInput text -> withCompose \state ->
    noMessages $ model { compose = Just state { text = text } }
  ComposeSurfaceClicked -> withCompose \state ->
    if state.visibilityMenuOpen then noMessages $ model { compose = Just state { visibilityMenuOpen = false } }
    else noMessages model
  ToggleVisibilityMenu -> withCompose \state ->
    let
      opening = not state.visibilityMenuOpen
    in
      Tuple (model { compose = Just state { visibilityMenuOpen = opening } })
        if opening then [ effect (focusFirstIn ".sp-vis-menu") ] else []
  SetVisibility visibility -> withCompose \state ->
    Tuple (model { compose = Just state { visibility = visibility, visibilityMenuOpen = false } })
      [ effect (focusById visibilityButtonId) ]
  SubmitPost -> withCompose \state ->
    if trim state.text == "" || state.submitting then noMessages model
    else
      Tuple (model { compose = Just state { submitting = true, error = Nothing, visibilityMenuOpen = false } })
        [ Just <<< PostSubmitted <$> createPost { text: state.text, visibility: state.visibility } ]
  PostSubmitted result -> withCompose \state -> case result of
    -- The backend has no posting contract yet, so this branch is unreachable today;
    -- it closes the form like any successful submit.
    Right _ -> closeCompose model
    Left error -> Tuple (model { compose = Just state { submitting = false, error = Just error } })
      [ effect (focusById composeTextId) ]

  ToggleProfileMenu opener -> case model.profileMenu of
    Just _ -> closeProfileMenu model
    Nothing ->
      let
        next = model { profileMenu = Just { opener, error: Nothing } }
      in
        Tuple next [ syncScrollLock next, effect (focusFirstIn ("#" <> profileMenuId)) ]
  CloseProfileMenu -> closeProfileMenu model
  SelectProfile profileId ->
    Tuple model [ Just <<< ProfileSelected <$> selectProfile profileId ]
  ProfileSelected result -> case result of
    Right context ->
      let
        Tuple closed closeEffects = closeProfileMenu (model { profileContext = Loaded context, muteBlock = model.muteBlock { profileKnown = false } })
        Tuple entered enterEffects = enterMuteBlock closed
      in
        Tuple entered (closeEffects <> enterEffects)
    Left error -> case model.profileMenu of
      Just state -> noMessages $ model { profileMenu = Just state { error = Just error } }
      Nothing -> noMessages model
  Logout -> Tuple model [ effect logoutAndReload ]
  MuteBlockMsg (MuteBlock.Go tab) ->
    mkUpdate nav model (Navigate (if tab == MuteBlock.AccountsTab then MuteBlockAccounts else MuteBlockDomains))
  MuteBlockMsg message -> delegate model message
  NoOp -> noMessages model
  where
  withCompose f = case model.compose of
    Just state -> f state
    Nothing -> noMessages model

type Step = { model :: Model, effects :: Array (Aff (Maybe Message)) }

effect :: Effect Unit -> Aff (Maybe Message)
effect run = liftEffect run $> Nothing

-- | Loads what the screen needs. Only Home and PostDetail have data today.
enterRoute :: Model -> Maybe Route -> Step
enterRoute model = case _ of
  Just Home ->
    { model: model { timeline = Loading }
    , effects: [ loadTimeline model.timelineTab ]
    }
  Just (PostDetail postId) ->
    { model: model { detail = Loading, detailTab = RepliesTab }
    , effects: [ Just <<< PostDetailLoaded postId <$> fetchPostDetail postId ]
    }
  _ -> { model, effects: [] }
  where
  loadTimeline tab = Just <<< TimelineLoaded tab <$> fetchTimeline tab

selectTimelineTab :: Model -> TimelineTab -> Boolean -> Tuple Model (Array (Aff (Maybe Message)))
selectTimelineTab model tab moveFocus =
  Tuple (model { timelineTab = tab, timeline = Loading })
    ( [ Just <<< TimelineLoaded tab <$> fetchTimeline tab ]
        <> if moveFocus then [ effect (focusById (timelineTabId tab)) ] else []
    )

selectDetailTab :: Model -> DetailTab -> Boolean -> Tuple Model (Array (Aff (Maybe Message)))
selectDetailTab model tab moveFocus =
  Tuple (model { detailTab = tab })
    (if moveFocus then [ effect (focusById (detailTabId tab)) ] else [])

closeCompose :: Model -> Tuple Model (Array (Aff (Maybe Message)))
closeCompose model = case model.compose of
  Just state ->
    let
      next = model { compose = Nothing }
    in
      Tuple next [ syncScrollLock next, effect (focusById (visibleOpener model state.opener)) ]
  Nothing -> noMessages model

closeProfileMenu :: Model -> Tuple Model (Array (Aff (Maybe Message)))
closeProfileMenu model = case model.profileMenu of
  Just state ->
    let
      next = model { profileMenu = Nothing }
    in
      Tuple next [ syncScrollLock next, effect (focusById (visibleOpener model state.opener)) ]
  Nothing -> noMessages model

-- | The desktop and mobile chrome each have their own compose / Profile button and
-- | only one of them is visible. The viewport may have crossed the breakpoint while
-- | the overlay was open, so focus returns to the twin that is visible now.
visibleOpener :: Model -> String -> String
visibleOpener model opener
  | opener == profileButtonDesktopId || opener == profileButtonMobileId =
      if model.isMobile then profileButtonMobileId else profileButtonDesktopId
  | opener == composeButtonDesktopId || opener == composeButtonMobileId =
      if model.isMobile then composeButtonMobileId else composeButtonDesktopId
  | otherwise = opener

-- | The page behind a modal layer does not scroll: the compose form (both widths) and
-- | the mobile Profile bottom sheet. The desktop Profile dropdown is not modal.
scrollLocked :: Model -> Boolean
scrollLocked model = isJust model.compose || (model.isMobile && isJust model.profileMenu) || isJust model.muteBlock.dialog

syncScrollLock :: Model -> Aff (Maybe Message)
syncScrollLock model = effect (setScrollLock (scrollLocked model))

-- | Esc closes the innermost layer only (ui-spec 投稿フォーム: an open visibility
-- | menu closes before the form).
escape :: Model -> Tuple Model (Array (Aff (Maybe Message)))
escape model = case model.compose of
  _ | isJust model.muteBlock.dialog -> delegate model MuteBlock.CloseDialog
  Just state
    | state.visibilityMenuOpen ->
        Tuple (model { compose = Just state { visibilityMenuOpen = false } })
          [ effect (focusById visibilityButtonId) ]
    | otherwise -> closeCompose model
  Nothing -> closeProfileMenu model

-- | Navigation closes any open overlay without moving focus back to its opener.
closeOverlays :: Model -> Step
closeOverlays model =
  let
    next = model { compose = Nothing, profileMenu = Nothing, muteBlock = model.muteBlock { dialog = Nothing } }
  in
    { model: next
    , effects: if scrollLocked model then [ syncScrollLock next ] else []
    }

-- | The mute/block page (D08) loads its lists once it is shown and the selected
-- | Profile is known; a Profile switch reloads them. A failed Profile context is
-- | shown as the page's error.
enterMuteBlock :: Model -> Tuple Model (Array (Aff (Maybe Message)))
enterMuteBlock model
  | onMuteBlock model.route && not model.muteBlock.profileKnown = case model.profileContext of
      Loaded context -> delegate model (MuteBlock.ProfileKnown (Right (map _.id context.activeProfile)))
      Failed error -> delegate model (MuteBlock.ProfileKnown (Left (failureOf error)))
      _ -> noMessages model
  | otherwise = noMessages model

onMuteBlock :: Maybe Route -> Boolean
onMuteBlock = case _ of
  Just MuteBlockAccounts -> true
  Just MuteBlockDomains -> true
  _ -> false

delegate :: Model -> MuteBlock.Message -> Tuple Model (Array (Aff (Maybe Message)))
delegate model message =
  let
    Tuple sub effects = MuteBlockUpdate.update model.muteBlock message
    next = model { muteBlock = sub }
    lock = if scrollLocked next /= scrollLocked model then [ syncScrollLock next ] else []
  in
    Tuple next (map (map (map MuteBlockMsg)) effects <> lock)

failureOf :: ApiError -> MuteBlock.Failure
failureOf = MuteBlock.Failure <<< case _ of
  Unauthenticated _ -> "UNAUTHENTICATED"
  Forbidden _ -> "FORBIDDEN"
  ProfileUnavailable _ -> "PROFILE_UNAVAILABLE"
  NotImplemented _ -> "NOT_IMPLEMENTED"
  Unavailable _ -> "UPSTREAM_UNAVAILABLE"
  NetworkError _ -> "NETWORK"
  _ -> "UPSTREAM_ERROR"
