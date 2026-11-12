-- | App shell (ui-spec L1 / L3): header with the Profile switcher, desktop sidebar,
-- | mobile bottom tab bar and the Profile menu (desktop dropdown / mobile bottom sheet).
-- |
-- | Desktop and mobile chrome are both rendered and switched by CSS media query
-- | (max-width: 767px), so SSR needs no viewport knowledge. Only overlays opened by
-- | the user (rendered after hydration) use model.isMobile to pick dropdown vs sheet.
module App.View.Shell
  ( header
  , sidebar
  , tabbar
  , profileMenu
  , profileButtonDesktopId
  , profileButtonMobileId
  , composeButtonDesktopId
  , composeButtonMobileId
  , profileMenuId
  , canCompose
  , isSignedIn
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.Error as Error
import App.Message (Message(..))
import App.Model (Model, ProfileMenuState, RemoteData(..), activeProfile)
import App.Profile (Profile)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, icon, loginHref, routeLink, testId, visuallyHidden)
import Data.Array (null)
import Data.Maybe (Maybe(..), isJust)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Flame.Types (NodeData)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))

profileButtonDesktopId :: String
profileButtonDesktopId = "sp-profile-desktop"

profileButtonMobileId :: String
profileButtonMobileId = "sp-profile-mobile"

composeButtonDesktopId :: String
composeButtonDesktopId = "sp-compose-desktop"

composeButtonMobileId :: String
composeButtonMobileId = "sp-compose-mobile"

profileMenuId :: String
profileMenuId = "sp-profile-menu"

-- | Posting needs an acting Profile (L2: the form shows who posts).
canCompose :: Model -> Boolean
canCompose = isJust <<< activeProfile

-- | A viewer the BFF holds a session for, in real mode: the Profile context loaded, or
-- | failed for a reason that needs the session (権限不足 / 選択 Profile の消失). Such a
-- | viewer can always log out (FA: switching to another account must stay possible).
isSignedIn :: Model -> Boolean
isSignedIn model = case model.apiMode, model.profileContext of
  Loaded REAL, Loaded _ -> true
  Loaded REAL, Failed (Forbidden _) -> true
  Loaded REAL, Failed (ProfileUnavailable _) -> true
  _, _ -> false

-- | The Profile switcher has something to offer: a loaded context, or one whose
-- | selected Profile vanished (the owned list still loads, so the viewer re-selects).
switcherContext :: Model -> Maybe (Maybe Profile)
switcherContext model = case model.profileContext of
  Loaded context -> Just context.activeProfile
  Failed (ProfileUnavailable _) -> Just Nothing
  _ -> Nothing

header :: Model -> Html Message
header model = HE.header [ HA.class' "sp-header" ]
  [ HE.div [ HA.class' "sp-header-desktop" ]
      [ brandLink
      , HE.div [ HA.class' "sp-header-right" ]
          [ notificationsLink
          , profileControlDesktop model
          ]
      ]
  , HE.div [ HA.class' "sp-header-mobile" ]
      [ profileControlMobile model
      , HE.span [ HA.class' "sp-brand" ] [ brandSymbol, HE.text "ShuttlePub" ]
      , notificationsLink
      ]
  ]

brandSymbol :: Html Message
brandSymbol = HE.span [ HA.class' "sp-brand-symbol" ] [ icon "repost" ]

brandLink :: Html Message
brandLink = routeLink Home [ HA.class' "sp-brand" ] [ brandSymbol, HE.text "ShuttlePub" ]

notificationsLink :: Html Message
notificationsLink = routeLink Notifications [ HA.class' "sp-icon-btn", attr "aria-label" "通知", HA.title "通知" ] [ icon "bell" ]

menuExpanded :: Model -> String
menuExpanded model = if isJust model.profileMenu then "true" else "false"

switchLabel :: Maybe Profile -> String
switchLabel = case _ of
  Just profile -> "投稿用 Profile を切り替え（現在: " <> profile.displayName <> "）"
  Nothing -> "投稿用 Profile を選択"

-- | Header-right Profile button (L1). Signed-out viewers get the login entry, which
-- | starts the IdP login and returns to the current screen.
profileControlDesktop :: Model -> Html Message
profileControlDesktop model = case switcherContext model, model.profileContext of
  Just active, _ -> HE.button
    [ HA.type' "button"
    , HA.id profileButtonDesktopId
    , HA.class' "sp-profile-btn"
    , HA.onClick (ToggleProfileMenu profileButtonDesktopId)
    , attr "aria-haspopup" "menu"
    , attr "aria-expanded" (menuExpanded model)
    , attr "aria-controls" profileMenuId
    , attr "aria-label" (switchLabel active)
    , testId "profile-switcher"
    ]
    case active of
      Just profile ->
        [ avatar AvatarSmall profile
        , HE.span [ HA.class' "sp-profile-names" ]
            [ HE.span [ HA.class' "sp-profile-name" ] [ HE.text profile.displayName ]
            , HE.span [ HA.class' "sp-profile-handle" ] [ HE.text ("@" <> profile.handle) ]
            ]
        , icon "chevdown"
        ]
      Nothing ->
        [ HE.span [ HA.class' "sp-profile-name" ] [ HE.text "Profile を選択" ], icon "chevdown" ]
  _, Failed error
    | Error.isSignedOut error -> loginLink model "sp-btn sp-btn-secondary" [ HE.text "ログイン" ]
    | otherwise -> profileError error
  _, _ -> profilePending

profileControlMobile :: Model -> Html Message
profileControlMobile model = case switcherContext model, model.profileContext of
  Just active, _ -> HE.button
    [ HA.type' "button"
    , HA.id profileButtonMobileId
    , HA.class' "sp-mob-avatar-btn"
    , HA.onClick (ToggleProfileMenu profileButtonMobileId)
    , attr "aria-haspopup" "dialog"
    , attr "aria-expanded" (menuExpanded model)
    , attr "aria-label" (switchLabel active)
    ]
    case active of
      Just profile -> [ avatar AvatarSmall profile, icon "chevdown" ]
      Nothing -> [ HE.span [ HA.class' "sp-avatar sp-avatar-sm sp-avatar-empty" ] [ HE.text "?" ], icon "chevdown" ]
  _, Failed error
    | Error.isSignedOut error -> loginLink model "sp-icon-btn" [ icon "login", visuallyHidden "ログイン" ]
    | otherwise -> profileError error
  _, _ -> profilePending

loginLink :: Model -> String -> Array (Html Message) -> Html Message
loginLink model className children = HE.a
  [ HA.href (loginHref model.route), HA.class' className, testId "login-link" ]
  children

profilePending :: Html Message
profilePending = HE.span [ HA.class' "sp-profile-pending", attr "aria-busy" "true" ]
  [ HE.span [ HA.class' "sp-avatar sp-avatar-sm sp-skeleton", attr "aria-hidden" "true" ] [ HE.text " " ]
  , visuallyHidden "Profile を読み込み中"
  ]

profileError :: Error.ApiError -> Html Message
profileError error = HE.span
  [ HA.class' "sp-profile-error"
  , attr "role" "status"
  , attr "data-error" (Error.tag error)
  , HA.title (Error.describe error)
  ]
  [ icon "warn", HE.span [ HA.class' "sp-profile-error-text" ] [ HE.text "Profile を取得できません" ] ]

-- | Desktop navigation (mock: ホーム・通知・検索・ブックマーク・設定 + 投稿する).
sidebar :: Model -> Html Message
sidebar model = HE.nav [ HA.class' "sp-sidebar", attr "aria-label" "メインナビゲーション" ]
  [ sideLink model Home "home" "ホーム"
  , sideLink model Notifications "bell" "通知"
  , sideLink model Search "search" "検索"
  , sideLink model Bookmarks "bookmark" "ブックマーク"
  , sideLink model Settings "settings" "設定"
  , HE.button
      [ HA.type' "button"
      , HA.id composeButtonDesktopId
      , HA.class' "sp-btn sp-btn-primary sp-sidebar-compose"
      , HA.onClick (OpenCompose composeButtonDesktopId)
      , HA.disabled (not (canCompose model))
      , attr "aria-haspopup" "dialog"
      ]
      [ icon "pencil", HE.text "投稿する" ]
  ]

isCurrent :: Model -> Route -> Boolean
isCurrent model route = case model.route, route of
  Just (PostDetail _), Home -> true
  Just MuteBlockAccounts, Settings -> true
  Just MuteBlockDomains, Settings -> true
  Just current, _ -> current == route
  Nothing, _ -> false

currentAttr :: Model -> Route -> Array (NodeData Message)
currentAttr model route = if isCurrent model route then [ attr "aria-current" "page" ] else []

sideLink :: Model -> Route -> String -> String -> Html Message
sideLink model route iconKind label = routeLink route
  ([ HA.class' ("sp-side-link" <> if isCurrent model route then " is-selected" else "") ] <> currentAttr model route)
  [ icon iconKind, HE.text label ]

-- | Mobile bottom tabs (L3: ホーム・検索・投稿・通知・設定).
tabbar :: Model -> Html Message
tabbar model = HE.nav [ HA.class' "sp-tabbar", attr "aria-label" "メインナビゲーション" ]
  [ tab Home "home" "ホーム"
  , tab Search "search" "検索"
  , HE.button
      [ HA.type' "button"
      , HA.id composeButtonMobileId
      , HA.class' "sp-tab"
      , HA.onClick (OpenCompose composeButtonMobileId)
      , HA.disabled (not (canCompose model))
      , attr "aria-haspopup" "dialog"
      , attr "aria-label" "投稿する"
      ]
      [ HE.span [ HA.class' "sp-tab-compose" ] [ icon "pencil" ] ]
  , tab Notifications "bell" "通知"
  , tab Settings "settings" "設定"
  ]
  where
  tab route iconKind label = routeLink route
    ([ HA.class' ("sp-tab" <> if isCurrent model route then " is-selected" else ""), attr "aria-label" label ] <> currentAttr model route)
    [ icon iconKind ]

-- | The Profile switcher menu (L1). Desktop: dropdown under the header button with a
-- | transparent click-away layer. Mobile: bottom sheet (aria-modal) over a backdrop.
profileMenu :: Model -> Html Message
profileMenu model = case model.profileMenu of
  Nothing -> emptySlot
  Just state
    | model.isMobile -> HE.div [ HA.class' "sp-sheet-backdrop", HA.onClick CloseProfileMenu ]
        [ HE.div
            [ HA.class' "sp-sheet"
            , attr "role" "dialog"
            , attr "aria-modal" "true"
            , attr "aria-label" "投稿用 Profile を切り替え"
            , HA.onClick NoOp
            ]
            [ HE.div [ HA.class' "sp-sheet-grip", attr "aria-hidden" "true" ] []
            , menuList model state
            ]
        ]
    | otherwise -> HE.div [ HA.class' "sp-menu-layer" ]
        [ HE.div [ HA.class' "sp-menu-clickaway", HA.onClick CloseProfileMenu ] []
        , HE.div [ HA.class' "sp-menu-popover", HA.onClick NoOp ] [ menuList model state ]
        ]

menuList :: Model -> ProfileMenuState -> Html Message
menuList model state = HE.div
  [ HA.id profileMenuId
  , HA.class' "sp-menu"
  , attr "role" "menu"
  , attr "aria-label" "投稿用 Profile を切り替え"
  , testId "profile-menu"
  ]
  ( profileItems <> errorItem
      <>
        [ HE.hr' [ attr "role" "separator", HA.class' "sp-menu-sep" ]
        , routeLink Settings [ HA.class' "sp-menu-item", attr "role" "menuitem" ]
            [ icon "settings", HE.span [ HA.class' "sp-grow" ] [ HE.text "設定" ] ]
        ]
      <>
        if isSignedIn model then
          [ HE.button [ HA.type' "button", HA.class' "sp-menu-item", attr "role" "menuitem", HA.onClick Logout ]
              [ icon "logout", HE.span [ HA.class' "sp-grow" ] [ HE.text "ログアウト" ] ]
          ]
        else []
  )
  where
  current = activeProfile model
  profileItems = case model.availableProfiles of
    Loaded profiles
      | null profiles -> [ HE.p [ HA.class' "sp-menu-note" ] [ HE.text "使える Profile がありません" ] ]
      | otherwise -> map profileItem profiles
    Failed error -> [ HE.p [ HA.class' "sp-menu-note sp-menu-error", attr "data-error" (Error.tag error) ] [ HE.text ("Profile 一覧を取得できません（" <> Error.describe error <> "）") ] ]
    _ -> [ HE.p [ HA.class' "sp-menu-note" ] [ HE.text "読み込み中…" ] ]
  errorItem = case state.error of
    Just error -> [ HE.p [ HA.class' "sp-menu-note sp-menu-error", attr "role" "alert", attr "data-error" (Error.tag error) ] [ HE.text ("切り替えられませんでした（" <> Error.describe error <> "）") ] ]
    Nothing -> []
  profileItem profile =
    let
      checked = map _.id current == Just profile.id
    in
      HE.button
        [ HA.type' "button"
        , HA.class' ("sp-menu-item" <> if checked then " is-current" else "")
        , attr "role" "menuitemradio"
        , attr "aria-checked" (if checked then "true" else "false")
        , HA.onClick (SelectProfile profile.id)
        ]
        [ avatar AvatarSmall profile
        , HE.span [ HA.class' "sp-grow" ]
            [ HE.span [ HA.class' "sp-menu-name" ] [ HE.text profile.displayName ]
            , HE.span [ HA.class' "sp-menu-sub" ] [ HE.text ("@" <> profile.handle) ]
            ]
        , if checked then icon "check" else emptySlot
        ]
