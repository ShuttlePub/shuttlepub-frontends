module Client.Update where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.Error as Error
import App.Api.GraphQL (createPost, fetchApiMode, fetchApiStatus, fetchAvailableProfiles, fetchPostDetail, fetchProfileContext, fetchTimeline, fetchUserPage, revealPost, revealUserPage, selectProfile)
import App.Dom (focusById, focusFirstIn, focusIfLost, logoutAndReload, scrollToTop, setScrollLock)
import App.Message (Message(..))
import App.Model (DetailTab(..), Model, PostDetailData, RemoteData(..), activeProfile, emptyCompose, fromEither)
import App.Post (Post, PostView, TimelineTab, timelineTabFromValue)
import App.View.Hidden (hideButtonId, revealButtonId)
import App.View.Pages (contentHeadingId, detailTabId, timelineTabId)
import App.MuteBlock.Types as MuteBlock
import App.MuteBlock.Update as MuteBlockUpdate
import App.Reaction (ReactionMsg(..))
import App.Route (Route(..), routeCodec)
import App.View.Auth (authActionId, authActionShown)
import App.View.Compose (composeTextId, visibilityButtonId)
import App.View.Shell (composeButtonDesktopId, composeButtonMobileId, profileButtonDesktopId, profileButtonMobileId, profileMenuId)
import Client.Reaction as QR
import Data.Array (any, filter, foldl, mapMaybe, snoc)
import Data.Either (Either(..), either)
import Data.Maybe (Maybe(..), isJust, isNothing, maybe)
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
      Tuple left leaveEffects = QR.leaveScreen model
      closed = closeOverlays left
      entered = (closed.model { route = route }) `enterRoute` route
      Tuple muteBlock muteBlockEffects = enterMuteBlock entered.model
    in
      Tuple muteBlock (leaveEffects <> closed.effects <> [ effect scrollToTop ] <> entered.effects <> muteBlockEffects <> if scrollLocked model then [ syncScrollLock muteBlock ] else [])
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
      refocus =
        if isMobile == model.isMobile then []
        else (if isJust model.profileMenu then [ effect (focusFirstIn ("#" <> profileMenuId)) ] else [])
          -- The post menu swaps popover <-> bottom sheet the same way.
          <> (if isJust model.content.menu then [ effect (focusFirstIn "#sp-post-menu") ] else [])
          <> QR.refocusPicker next
    in
      Tuple next ([ syncScrollLock next ] <> refocus)
  ApiModeLoaded result ->
    noMessages $ model { apiMode = fromEither result }
  ApiStatusLoaded result ->
    noMessages $ model { apiStatus = fromEither result }
  ProfileContextLoaded result ->
    profileChanged (model { profileContext = fromEither result })
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
      "picker" -> QR.selectCategory model action.value true
      _ -> noMessages model
    _ -> noMessages model
  DocumentEscape -> escape model

  SelectTimelineTab tab -> selectTimelineTab model tab false
  TimelineLoaded tab epoch result
    | tab == model.timelineTab && epoch == model.content.epoch ->
        withRefocus (QR.postsShown (either (const []) identity result) (model { timeline = fromEither result }))
    | otherwise -> noMessages model
  PostDetailLoaded postId epoch result
    | model.route == Just (PostDetail postId) && epoch == model.content.epoch ->
        withRefocus (QR.postsShown (either (const []) detailPosts result) (model { detail = fromEither result }))
    | otherwise -> noMessages model
  UserPageLoaded handle epoch result
    | model.route == Just (UserProfile handle) && epoch == model.content.epoch ->
        withRefocus (QR.postsShown (either (const []) (maybe [] (\page -> viewPosts page.posts)) result) (model { content = model.content { user = fromEither result } }))
    | otherwise -> noMessages model

  -- ui-spec 3-1 / 3-2 / 3-5 (S8 single-note reveal, page-local).
  RevealPost id -> case model.content.profile of
    Just profile | not (any (\pending -> pending.id == id) model.content.revealing) ->
      let
        Tuple next request = askReveal id model
      in
        Tuple (next { content = next.content { revealError = Nothing } }) [ Just <<< PostRevealed id request <$> revealPost profile id ]
    _ -> noMessages model
  PostRevealed id request result
    -- Not the request this post waits for: superseded, or [隠す] / leaving forgot it.
    | not (any (\pending -> pending.id == id && pending.request == request) model.content.revealing) -> noMessages model
    | otherwise ->
        let
          settled = model { content = model.content { revealing = filter (\pending -> pending.id /= id) model.content.revealing } }
          -- No (new) reveal: the post is hidden again, with the error and its reveal button
          -- to retry; nothing of an older reveal stays shown.
          failed error =
            Tuple
              (settled { content = settled.content { reveals = filter (\view -> view.id /= id) settled.content.reveals, revealError = Just { id, error } } })
              [ effect (focusIfLost [ revealButtonId id, contentHeadingId ]) ]
        in
          case result of
            Right (Just view) ->
              let
                shown = settled { content = settled.content { reveals = snoc (filter (\other -> other.id /= id) settled.content.reveals) view } }
                Tuple next effects = QR.postsShown (viewPosts [ view ]) shown
              in
                Tuple next (effects <> [ effect (focusById (hideButtonId id)) ])
            Right Nothing -> failed (Unexpected "The post is gone")
            Left error -> failed error
  -- [隠す] drops the page's reveal and any reveal still on its way (S8: hide discards).
  HidePost id ->
    Tuple
      ( model
          { content = model.content
              { reveals = filter (\view -> view.id /= id) model.content.reveals
              , revealing = filter (\pending -> pending.id /= id) model.content.revealing
              }
          }
      )
      [ effect (focusById (revealButtonId id)) ]
  ToggleHiddenReplies -> noMessages model { content = model.content { repliesOpen = not model.content.repliesOpen } }
  RevealUserPosts -> case model.content.profile, model.route of
    Just profile, Just (UserProfile handle) | isNothing model.content.userRevealing ->
      let
        request = model.content.revealSeq + 1
      in
        Tuple (model { content = model.content { revealSeq = request, userRevealing = Just request, userRevealError = Nothing } })
          [ Just <<< UserPostsRevealed handle request <$> revealUserPage profile handle ]
    _, _ -> noMessages model
  UserPostsRevealed handle request result
    | model.content.userRevealing /= Just request || model.route /= Just (UserProfile handle) -> noMessages model
    | otherwise ->
        let
          settled = model { content = model.content { userRevealing = Nothing } }
          failed error =
            Tuple
              (settled { content = settled.content { userRevealed = Nothing, userRevealError = Just error } })
              [ effect (focusIfLost [ revealButtonId "user", contentHeadingId ]) ]
        in
          case result of
            Right (Just page) ->
              let
                Tuple next effects = QR.postsShown (viewPosts page.posts) (settled { content = settled.content { userRevealed = Just page } })
              in
                Tuple next (effects <> [ effect (focusById (hideButtonId "user")) ])
            Right Nothing -> failed (Unexpected "The person is gone")
            Left error -> failed error
  HideUserPosts ->
    Tuple (model { content = model.content { userRevealed = Nothing, userRevealing = Nothing } }) [ effect (focusById (revealButtonId "user")) ]

  -- The "…" menu (ui-spec 1-1 主導線). Desktop: popover under the button; mobile:
  -- bottom sheet. Esc / click-away close it and return focus to the button.
  OpenPostMenu key opener ->
    let
      next = model { content = model.content { menu = Just { postId: key, opener } }, profileMenu = Nothing, reaction = model.reaction { picker = Nothing, chipMenu = Nothing } }
    in
      Tuple next [ syncScrollLock next, effect (focusFirstIn "#sp-post-menu") ]
  ClosePostMenu -> closePostMenu model
  MenuAction message -> case model.content.menu of
    Just menu ->
      let
        closed = model { content = model.content { menu = Nothing, refocus = Just menu.opener } }
        Tuple next effects = delegate closed message
        -- A dialog takes focus itself; an immediate action returns it to the button
        -- (or, once its post is gone, to the page heading).
        back = if isJust next.muteBlock.dialog then [] else [ effect (focusIfLost [ menu.opener, contentHeadingId ]) ]
      in
        Tuple next (effects <> [ syncScrollLock next ] <> back)
    Nothing -> noMessages model
  SelectDetailTab tab -> selectDetailTab model tab false

  OpenCompose opener ->
    let
      next = model { compose = Just (emptyCompose opener), profileMenu = Nothing, reaction = model.reaction { picker = Nothing, chipMenu = Nothing } }
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
        next = model { profileMenu = Just { opener, error: Nothing }, reaction = model.reaction { picker = Nothing, chipMenu = Nothing } }
      in
        Tuple next [ syncScrollLock next, effect (focusFirstIn ("#" <> profileMenuId)) ]
  CloseProfileMenu -> closeProfileMenu model
  SelectProfile profileId ->
    Tuple model [ Just <<< ProfileSelected <$> selectProfile profileId ]
  ProfileSelected result -> case result of
    Right context ->
      let
        Tuple closed closeEffects = closeProfileMenu (model { profileContext = Loaded context })
        Tuple synced syncEffects = profileChanged closed
      in
        Tuple synced (closeEffects <> syncEffects)
    -- Session-loss UI, reaction transport and the mute/block page all follow the changed Profile context.
    Left error | endsSession error ->
      let
        next = model { profileContext = Failed error, availableProfiles = Failed error, profileMenu = Nothing }
        Tuple synced syncEffects = profileChanged next
      in
        Tuple synced (syncEffects <> [ syncScrollLock synced, effect (focusById authActionId) ])
    Left error -> case model.profileMenu of
      Just state -> noMessages $ model { profileMenu = Just state { error = Just error } }
      Nothing -> noMessages model
  Logout -> Tuple model [ effect logoutAndReload ]
  MuteBlockMsg (MuteBlock.Go tab) ->
    mkUpdate nav model (Navigate (if tab == MuteBlock.AccountsTab then MuteBlockAccounts else MuteBlockDomains))
  MuteBlockMsg MuteBlock.OpenSettings -> mkUpdate nav model (Navigate Settings)
  MuteBlockMsg message -> delegate model message
  -- The reaction toast is inert behind an open mute/block dialog; its actions (which
  -- may navigate away) are refused here too, so the dialog and its input survive.
  Reaction message | isJust model.muteBlock.dialog && toastAction message -> noMessages model
  Reaction message ->
    let
      Tuple next effects = QR.update model message
    in
      Tuple next (effects <> if scrollLocked next /= scrollLocked model then [ syncScrollLock next ] else [])
  NoOp -> noMessages model
  where
  withCompose f = case model.compose of
    Just state -> f state
    Nothing -> noMessages model
  endsSession error = Error.isSignedOut error || case error of
    Forbidden _ -> true
    _ -> false

type Step = { model :: Model, effects :: Array (Aff (Maybe Message)) }

effect :: Effect Unit -> Aff (Maybe Message)
effect run = liftEffect run $> Nothing

-- | Loads what the screen needs: Home, a post and a person's page have content. A new
-- | screen starts with nothing revealed (S8 reveals are page-local).
enterRoute :: Model -> Maybe Route -> Step
enterRoute model = case _ of
  Just Home -> requestContent (fresh model) { timeline = Loading }
  Just (PostDetail _) -> requestContent (fresh model) { detail = Loading, detailTab = RepliesTab }
  Just (UserProfile _) -> requestContent (fresh model) { content { user = Loading } }
  _ -> { model, effects: [] }
  where
  fresh m = m
    { content = m.content
        { reveals = []
        , revealing = []
        , revealError = Nothing
        , repliesOpen = false
        , userRevealed = Nothing
        , userRevealing = Nothing
        , userRevealError = Nothing
        , menu = Nothing
        , refocus = Nothing
        }
    }

-- | Requests the shown screen's content for the current Profile context, in a new
-- | epoch (older answers are dropped). Until the Profile context is known it waits:
-- | the Profile's own domain controls decide what is shown. Revealed posts of the page
-- | are revealed again (after a mute/block change they may show more or less): until
-- | that answer they are hidden and pending, so nothing (operations included) of the
-- | reveal made under the old controls is used; a failed answer leaves them hidden with
-- | the error and the reveal button to retry (ui-spec 3-3 / 3-6).
requestContent :: Model -> Step
requestContent model = case model.profileContext of
  Loaded _ -> request
  Failed _ -> request
  _ -> { model: model { content = model.content { waiting = true } }, effects: [] }
  where
  profile = map _.id (activeProfile model)
  epoch = model.content.epoch + 1
  -- Reveals of this page are asked for again, each as a new request.
  base = model
    { content = model.content
        { epoch = epoch
        , profile = profile
        , waiting = false
        , reveals = []
        , revealing = []
        , revealError = Nothing
        , userRevealed = Nothing
        , userRevealing = Nothing
        , userRevealError = Nothing
        , controlsSeen = case model.muteBlock.domains of
            MuteBlock.Ready list -> Just list
            -- Still loading: the list that arrives is the one this content was asked with.
            _ -> Nothing
        }
    }
  rerevealed = case profile of
    Just id | contentRoute model.route -> foldl
      ( \acc view -> case askReveal view.id acc.model of
          Tuple next asked -> { model: next, effects: snoc acc.effects (Just <<< PostRevealed view.id asked <$> revealPost id view.id) }
      )
      { model: base, effects: [] }
      model.content.reveals
    _ -> { model: base, effects: [] }
  userReveal = case profile, model.route, model.content.userRevealed of
    Just id, Just (UserProfile handle), Just _ ->
      let
        req = rerevealed.model.content.revealSeq + 1
      in
        { model: rerevealed.model { content = rerevealed.model.content { revealSeq = req, userRevealing = Just req } }
        , effects: [ Just <<< UserPostsRevealed handle req <$> revealUserPage id handle ]
        }
    _, _, _ -> { model: rerevealed.model, effects: [] }
  request =
    { model: userReveal.model
    , effects: case model.route of
        Just Home -> [ Just <<< TimelineLoaded model.timelineTab epoch <$> fetchTimeline profile model.timelineTab ]
        Just (PostDetail postId) -> [ Just <<< PostDetailLoaded postId epoch <$> fetchPostDetail profile postId ] <> rerevealed.effects
        Just (UserProfile handle) -> [ Just <<< UserPageLoaded handle epoch <$> fetchUserPage profile handle ] <> rerevealed.effects <> userReveal.effects
        _ -> []
    }

-- | A new reveal request for one post: its id is what the answer must carry.
askReveal :: String -> Model -> Tuple Model Int
askReveal id model =
  let
    request = model.content.revealSeq + 1
  in
    Tuple
      (model { content = model.content { revealSeq = request, revealing = snoc (filter (\pending -> pending.id /= id) model.content.revealing) { id, request } } })
      request

contentRoute :: Maybe Route -> Boolean
contentRoute = case _ of
  Just Home -> true
  Just (PostDetail _) -> true
  Just (UserProfile _) -> true
  _ -> false

-- | The posts a screen shows (for their reactions, D03): visible views only.
viewPosts :: Array PostView -> Array Post
viewPosts = mapMaybe _.post

detailPosts :: PostDetailData -> Array Post
detailPosts found = viewPosts (maybe [] pure found.view <> found.replies)

-- | Content arrived: if a menu action took the focused post away, focus goes back to
-- | its button or the page heading (only when focus was actually lost).
withRefocus :: Tuple Model (Array (Aff (Maybe Message))) -> Tuple Model (Array (Aff (Maybe Message)))
withRefocus (Tuple model effects) = case model.content.refocus of
  Just opener -> Tuple (model { content = model.content { refocus = Nothing } }) (effects <> [ effect (focusIfLost [ opener, contentHeadingId ]) ])
  Nothing -> Tuple model effects

closePostMenu :: Model -> Tuple Model (Array (Aff (Maybe Message)))
closePostMenu model = case model.content.menu of
  Just menu ->
    let
      next = model { content = model.content { menu = Nothing } }
    in
      Tuple next [ syncScrollLock next, effect (focusById menu.opener) ]
  Nothing -> noMessages model

selectTimelineTab :: Model -> TimelineTab -> Boolean -> Tuple Model (Array (Aff (Maybe Message)))
selectTimelineTab model tab moveFocus =
  let
    requested = requestContent (model { timelineTab = tab, timeline = Loading })
  in
    Tuple requested.model
      (requested.effects <> if moveFocus then [ effect (focusById (timelineTabId tab)) ] else [])

selectDetailTab :: Model -> DetailTab -> Boolean -> Tuple Model (Array (Aff (Maybe Message)))
selectDetailTab model tab moveFocus =
  Tuple ((if tab == ReactionsTab && model.detailTab /= ReactionsTab then QR.detailReactionsOpened else identity) model { detailTab = tab })
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
  | opener == profileButtonDesktopId || opener == profileButtonMobileId = headerSwitcher model
  | opener == composeButtonDesktopId || opener == composeButtonMobileId =
      if model.isMobile then composeButtonMobileId else composeButtonDesktopId
  -- Opened from the session notice: back to it, unless the menu resolved the notice
  -- (a Profile was chosen) and it is gone; then to the header switcher (ui-spec 実装上の注意 6).
  | opener == authActionId = if authActionShown model then authActionId else headerSwitcher model
  | otherwise = opener

headerSwitcher :: Model -> String
headerSwitcher model = if model.isMobile then profileButtonMobileId else profileButtonDesktopId

-- | The page behind a modal layer does not scroll: the compose form (both widths) and
-- | the mobile Profile bottom sheet. The desktop Profile dropdown is not modal.
scrollLocked :: Model -> Boolean
scrollLocked model = isJust model.compose || (model.isMobile && isJust model.profileMenu) || QR.pickerLocksScroll model || isJust model.muteBlock.dialog
  || (model.isMobile && isJust model.content.menu)

syncScrollLock :: Model -> Aff (Maybe Message)
syncScrollLock model = effect (setScrollLock (scrollLocked model))

-- | Esc closes the innermost layer only (ui-spec 投稿フォーム: an open visibility
-- | menu closes before the form).
escape :: Model -> Tuple Model (Array (Aff (Maybe Message)))
escape model = case model.compose of
  _ | isJust model.muteBlock.dialog -> delegate model MuteBlock.CloseDialog
  _ | isJust model.content.menu -> closePostMenu model
  Just state
    | state.visibilityMenuOpen ->
        Tuple (model { compose = Just state { visibilityMenuOpen = false } })
          [ effect (focusById visibilityButtonId) ]
    | otherwise -> closeCompose model
  Nothing -> case QR.escape model of
    Just (Tuple next effects) -> Tuple next (effects <> [ syncScrollLock next ])
    Nothing -> closeProfileMenu model

-- | Navigation closes any open overlay without moving focus back to its opener.
closeOverlays :: Model -> Step
closeOverlays model =
  let
    next = model { compose = Nothing, profileMenu = Nothing, muteBlock = model.muteBlock { dialog = Nothing }, content = model.content { menu = Nothing } }
  in
    { model: next
    , effects: if scrollLocked model then [ syncScrollLock next ] else []
    }

-- | The Profile context changed (loaded, switched or lost): quick reaction follows it,
-- | and the mute/block page reloads for the new Profile (its stale answers are dropped).
profileChanged :: Model -> Tuple Model (Array (Aff (Maybe Message)))
profileChanged model =
  let
    Tuple synced syncEffects = QR.syncProfile (model { muteBlock = model.muteBlock { profileKnown = false } })
    Tuple entered enterEffects = enterMuteBlock synced
    -- Content shown for another Profile (or still waiting for one) is requested again,
    -- from scratch: reveals were the previous Profile's.
    changed = contentRoute entered.route && (entered.content.waiting || entered.content.profile /= map _.id (activeProfile entered))
    content = if changed then enterRoute entered entered.route else { model: entered, effects: [] }
  in
    Tuple content.model (syncEffects <> enterEffects <> content.effects)

-- | The mute/block page (D08) loads its lists once it is shown and the selected
-- | Profile is known; a Profile switch reloads them. A failed Profile context is
-- | shown as the page's error.
enterMuteBlock :: Model -> Tuple Model (Array (Aff (Maybe Message)))
enterMuteBlock model
  | (onMuteBlock model.route || contentRoute model.route) && not model.muteBlock.profileKnown = case model.profileContext of
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
    -- The content follows the Profile's domain controls (S8): whenever the list differs
    -- from the one the shown content was asked with, by a write here or by a reload
    -- (e.g. after a 409 from a change in another tab), ask again. The first list of a
    -- Profile only becomes the reference.
    refreshed = case sub.domains, next.content.controlsSeen of
      MuteBlock.Ready after, Just seen | after /= seen && contentRoute next.route -> requestContent next
      MuteBlock.Ready after, Nothing -> { model: next { content = next.content { controlsSeen = Just after } }, effects: [] }
      _, _ -> { model: next, effects: [] }
  in
    Tuple refreshed.model (map (map (map MuteBlockMsg)) effects <> lock <> refreshed.effects)

toastAction :: ReactionMsg -> Boolean
toastAction = case _ of
  ToastUndo -> true
  ToastAction -> true
  _ -> false

failureOf :: ApiError -> MuteBlock.Failure
failureOf = MuteBlock.Failure <<< case _ of
  Unauthenticated _ -> "UNAUTHENTICATED"
  SessionExpired _ -> "SESSION_EXPIRED"
  Forbidden _ -> "FORBIDDEN"
  ProfileUnavailable _ -> "PROFILE_UNAVAILABLE"
  NotImplemented _ -> "NOT_IMPLEMENTED"
  Unavailable _ -> "UPSTREAM_UNAVAILABLE"
  NetworkError _ -> "NETWORK"
  _ -> "UPSTREAM_ERROR"
