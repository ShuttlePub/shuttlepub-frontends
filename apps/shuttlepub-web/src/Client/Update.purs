module Client.Update where

import Prelude

import App.Api.GraphQL (createPost, fetchApiMode, fetchApiStatus, fetchAvailableProfiles, fetchPostDetail, fetchProfileContext, fetchTimeline, selectProfile)
import App.Dom (focusById, focusFirstIn, logoutAndReload, scrollToTop, setScrollLock)
import App.Message (Message(..))
import App.Model (DetailTab(..), Model, RemoteData(..), emptyCompose, fromEither)
import App.Post (TimelineTab, timelineTabFromValue)
import App.Route (Route(..), routeCodec)
import App.View.Compose (composeTextId, visibilityButtonId)
import App.View.Pages (detailTabId, timelineTabId)
import App.View.Shell (profileButtonDesktopId, profileButtonMobileId, profileMenuId)
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
    in
      Tuple entered.model (closed.effects <> [ effect scrollToTop ] <> entered.effects)
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
    noMessages $ model { isMobile = isMobile }
  ApiModeLoaded result ->
    noMessages $ model { apiMode = fromEither result }
  ApiStatusLoaded result ->
    noMessages $ model { apiStatus = fromEither result }
  ProfileContextLoaded result ->
    noMessages $ model { profileContext = fromEither result }
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
    Tuple (model { compose = Just (emptyCompose opener), profileMenu = Nothing })
      [ effect (setScrollLock true), effect (focusById composeTextId) ]
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
      Tuple (model { profileMenu = Just { opener, error: Nothing } })
        ([ effect (focusFirstIn ("#" <> profileMenuId)) ] <> if model.isMobile then [ effect (setScrollLock true) ] else [])
  CloseProfileMenu -> closeProfileMenu model
  SelectProfile profileId ->
    Tuple model [ Just <<< ProfileSelected <$> selectProfile profileId ]
  ProfileSelected result -> case result of
    Right context -> closeProfileMenu (model { profileContext = Loaded context })
    Left error -> case model.profileMenu of
      Just state -> noMessages $ model { profileMenu = Just state { error = Just error } }
      Nothing -> noMessages model
  Logout -> Tuple model [ effect logoutAndReload ]
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
  Just state -> Tuple (model { compose = Nothing })
    [ effect (setScrollLock false), effect (focusById state.opener) ]
  Nothing -> noMessages model

closeProfileMenu :: Model -> Tuple Model (Array (Aff (Maybe Message)))
closeProfileMenu model = case model.profileMenu of
  Just state -> Tuple (model { profileMenu = Nothing })
    [ effect (setScrollLock false), effect (focusById (openerFor state.opener)) ]
  Nothing -> noMessages model
  where
  -- The viewport may have changed while the menu was open; return focus to the
  -- switcher that is visible now.
  openerFor opener
    | opener == profileButtonDesktopId || opener == profileButtonMobileId =
        if model.isMobile then profileButtonMobileId else profileButtonDesktopId
    | otherwise = opener

-- | Esc closes the innermost layer only (ui-spec 投稿フォーム: an open visibility
-- | menu closes before the form).
escape :: Model -> Tuple Model (Array (Aff (Maybe Message)))
escape model = case model.compose of
  Just state
    | state.visibilityMenuOpen ->
        Tuple (model { compose = Just state { visibilityMenuOpen = false } })
          [ effect (focusById visibilityButtonId) ]
    | otherwise -> closeCompose model
  Nothing -> closeProfileMenu model

-- | Navigation closes any open overlay without moving focus back to its opener.
closeOverlays :: Model -> Step
closeOverlays model =
  { model: model { compose = Nothing, profileMenu = Nothing }
  , effects: if isJust model.compose || isJust model.profileMenu then [ effect (setScrollLock false) ] else []
  }
