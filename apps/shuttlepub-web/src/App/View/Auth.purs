-- | FA login UI inside the SNS shell. Credentials are entered on the IdP's (Emumet's)
-- | own screen: this app only offers the entry to the OIDC login (bff/auth.ts
-- | /auth/login), explains why a viewer is signed out and offers the way back in or out.
-- |
-- | Nothing here decides authentication: every state comes from a BFF answer
-- | (GraphQL extensions.code / reason, or the callback's fixed /login?error= reason).
module App.View.Auth
  ( loginPage
  , authNotice
  , authActionId
  , LoginReason(..)
  , loginReason
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Message (Message(..))
import App.Model (Model, RemoteData(..))
import App.Route (Route(..))
import App.View.Common (attr, emptySlot, icon, loginHref, routeLink, testId)
import App.View.Shell (isSignedIn, profileButtonDesktopId, profileButtonMobileId)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

-- | The callback's failure reasons (bff/auth.ts LOGIN_ERROR_PATHS). Any other value of
-- | ?error= is ignored: the screen never shows text it did not define itself.
data LoginReason = LoginDenied | LoginFailed

derive instance Eq LoginReason

loginReason :: Maybe String -> Maybe LoginReason
loginReason = case _ of
  Just "denied" -> Just LoginDenied
  Just "failed" -> Just LoginFailed
  _ -> Nothing

-- | /login: what happens next (the IdP's screen) and one button to go there.
-- | SSR renders the signed-out form; a viewer who turns out to be signed in after
-- | hydration sees that instead of a second login.
loginPage :: Model -> Maybe String -> Html Message
loginPage model error = HE.div [ HA.class' "sp-page sp-page-padded sp-page-login", testId "login-page" ]
  [ HE.h1 [ HA.class' "sp-page-title" ] [ HE.text "ログイン" ]
  , HE.p [ HA.class' "sp-muted sp-login-lead" ]
      [ HE.text "ShuttlePub には Emumet のアカウントでログインします。続けると Emumet のログイン画面に移動します。" ]
  , case loginReason error of
      Just LoginDenied -> notice "login-error" "denied" false "warn"
        "ログインがキャンセルされたため、ログインしていません。"
        emptySlot
      Just LoginFailed -> notice "login-error" "failed" true "warn"
        "ログインできませんでした。もう一度お試しください。"
        emptySlot
      Nothing -> emptySlot
  , HE.div [ HA.class' "sp-login-actions" ]
      if signedIn then
        [ HE.p [ HA.class' "sp-login-done", testId "login-state", attr "data-state" "signed-in" ] [ HE.text "ログイン済みです。" ]
        , routeLink Home [ HA.class' "sp-btn sp-btn-secondary" ] [ HE.text "ホームへ" ]
        ]
      else
        [ HE.a [ HA.href (loginHref model.route), HA.class' "sp-btn sp-btn-primary", testId "login-start" ]
            [ icon "login", HE.text "Emumet でログイン" ]
        ]
  ]
  where
  signedIn = case model.profileContext of
    Loaded _ -> true
    _ -> isSignedIn model

-- | The notice's action (login / logout / re-select). Focus lands here when the open
-- | Profile menu learns that the session ended.
authActionId :: String
authActionId = "sp-auth-action"

-- | One line above the screen body for the viewer's session state, with the action
-- | that resolves it. Absent (an empty slot) while loading and when signed in.
authNotice :: Model -> Html Message
authNotice model = case model.profileContext, model.route of
  Failed (Unauthenticated _), Just (Login _) -> emptySlot
  Failed (SessionExpired _), Just (Login _) -> emptySlot
  Failed (Unauthenticated _), _ -> notice "auth-notice" "signed-out" false "login"
    "ログインしていません。投稿や Profile の切り替えにはログインが必要です。"
    loginButton
  Failed (SessionExpired _), _ -> notice "auth-notice" "expired" false "warn"
    "ログインの有効期限が切れました。もう一度ログインしてください。"
    loginButton
  Failed (Forbidden _), _ -> notice "auth-notice" "forbidden" true "warn"
    "このアカウントでは ShuttlePub を利用できません。別のアカウントでログインし直してください。"
    (HE.button [ HA.type' "button", HA.id authActionId, HA.class' "sp-btn sp-btn-secondary", HA.onClick Logout ] [ icon "logout", HE.text "ログアウト" ])
  Failed (ProfileUnavailable _), _ -> notice "auth-notice" "profile-unavailable" false "warn"
    "選んでいた Profile が使えなくなりました。Profile を選び直してください。"
    ( HE.button
        [ HA.type' "button"
        , HA.id authActionId
        , HA.class' "sp-btn sp-btn-secondary"
        , HA.onClick (ToggleProfileMenu (if model.isMobile then profileButtonMobileId else profileButtonDesktopId))
        , attr "aria-haspopup" (if model.isMobile then "dialog" else "menu")
        ]
        [ HE.text "Profile を選ぶ" ]
    )
  _, _ -> emptySlot
  where
  loginButton = HE.a [ HA.href (loginHref model.route), HA.id authActionId, HA.class' "sp-btn sp-btn-primary" ] [ icon "login", HE.text "ログイン" ]

notice :: String -> String -> Boolean -> String -> String -> Html Message -> Html Message
notice id state isError iconKind text action = HE.div
  [ HA.class' ("sp-notice" <> if isError then " is-error" else "")
  , attr "role" "status"
  , testId id
  , attr "data-state" state
  ]
  [ icon iconKind
  , HE.p [ HA.class' "sp-notice-text" ] [ HE.text text ]
  , action
  ]
