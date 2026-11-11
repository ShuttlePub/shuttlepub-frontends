-- | FA login UI inside the SNS shell. Credentials are entered on the IdP's (Emumet's)
-- | own screen: this app only offers the entry to the OIDC login (bff/auth.ts
-- | /auth/login), explains why a viewer is signed out and offers the way back in or out.
-- |
-- | Nothing here decides authentication: every state comes from a BFF answer
-- | (GraphQL extensions.code / reason, or the fixed /login?error= reason).
module App.View.Auth
  ( loginPage
  , authNotice
  , authActionId
  , authActionShown
  , LoginReason(..)
  , loginReason
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Message (Message(..))
import App.Model (Model, RemoteData(..))
import App.Route (Route(..))
import App.View.Common (attr, emptySlot, icon, loginHref, routeLink, testId)
import Data.Maybe (Maybe(..), isJust)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

-- | The fixed reasons /login can show: the callback's failures (bff/auth.ts
-- | LOGIN_ERROR_PATHS) and an expired session. Any other value of ?error= is
-- | ignored: the screen never shows text it did not define itself.
data LoginReason = LoginDenied | LoginFailed | LoginExpired

derive instance Eq LoginReason

loginReason :: Maybe String -> Maybe LoginReason
loginReason = case _ of
  Just "denied" -> Just LoginDenied
  Just "failed" -> Just LoginFailed
  Just "expired" -> Just LoginExpired
  _ -> Nothing

-- | The one element that resolves the viewer's session state: the notice's action
-- | (login / logout / re-select) or, on /login where no signed-out notice is shown,
-- | the login button. Never rendered twice. Focus lands here when the open Profile
-- | menu learns that the session ended, and returns here when the menu was opened
-- | from the notice.
authActionId :: String
authActionId = "sp-auth-action"

-- | Whether the view currently renders authActionId.
authActionShown :: Model -> Boolean
authActionShown model = noticeShown model || loginStartShown model

-- | /login shows the sign-in entry unless the viewer has a session (a loaded context, or
-- | a failure that needs one). Independent of apiMode, which may arrive later: the
-- | entry and a notice action must never both carry authActionId.
loginSignedIn :: Model -> Boolean
loginSignedIn model = case model.profileContext of
  Loaded _ -> true
  Failed (Forbidden _) -> true
  Failed (ProfileUnavailable _) -> true
  _ -> false

loginStartShown :: Model -> Boolean
loginStartShown model = case model.route of
  Just (Login _) -> not (loginSignedIn model)
  _ -> false

-- | /login: what happens next (the IdP's screen) and one button to go there.
-- | SSR renders the signed-out form; a viewer who turns out to be signed in after
-- | hydration sees that instead of a second login (and no stale failure reason).
loginPage :: Model -> Maybe String -> Html Message
loginPage model error = HE.div [ HA.class' "sp-page sp-page-padded sp-page-login", testId "login-page" ]
  [ HE.h1 [ HA.class' "sp-page-title" ] [ HE.text "ログイン" ]
  , HE.p [ HA.class' "sp-muted sp-login-lead" ]
      [ HE.text "ShuttlePub には Emumet のアカウントでログインします。続けると Emumet のログイン画面に移動します。" ]
  , case loginReason error of
      _ | signedIn -> emptySlot
      Just LoginDenied -> notice "login-error" "denied" false "warn"
        "ログインがキャンセルされたため、ログインしていません。"
        emptySlot
      Just LoginFailed -> notice "login-error" "failed" true "warn"
        "ログインできませんでした。もう一度お試しください。"
        emptySlot
      Just LoginExpired -> notice "login-error" "expired" false "warn"
        expiredText
        emptySlot
      Nothing -> emptySlot
  , HE.div [ HA.class' "sp-login-actions" ]
      if signedIn then
        [ HE.p [ HA.class' "sp-login-done", testId "login-state", attr "data-state" "signed-in" ] [ HE.text "ログイン済みです。" ]
        , routeLink Home [ HA.class' "sp-btn sp-btn-secondary" ] [ HE.text "ホームへ" ]
        ]
      else
        [ HE.a [ HA.href (loginHref model.route), HA.id authActionId, HA.class' "sp-btn sp-btn-primary", testId "login-start" ]
            [ icon "login", HE.text "Emumet でログイン" ]
        ]
  ]
  where
  signedIn = loginSignedIn model

expiredText :: String
expiredText = "ログインの有効期限が切れました。もう一度ログインしてください。"

-- | Which notice applies. /login is itself the way in, so it shows no signed-out notice.
noticeShown :: Model -> Boolean
noticeShown model = case model.profileContext, model.route of
  Failed (Unauthenticated _), Just (Login _) -> false
  Failed (SessionExpired _), Just (Login _) -> false
  Failed (Unauthenticated _), _ -> true
  Failed (SessionExpired _), _ -> true
  Failed (Forbidden _), _ -> true
  Failed (ProfileUnavailable _), _ -> true
  _, _ -> false

-- | One line above the screen body for the viewer's session state, with the action
-- | that resolves it. Absent (an empty slot) while loading and when signed in.
authNotice :: Model -> Html Message
authNotice model
  | not (noticeShown model) = emptySlot
  | otherwise =
      case model.profileContext of
        Failed (SessionExpired _) -> notice "auth-notice" "expired" false "warn" expiredText loginButton
        Failed (Forbidden _) -> notice "auth-notice" "forbidden" true "warn"
          "このアカウントでは ShuttlePub を利用できません。別のアカウントでログインし直してください。"
          (HE.button [ HA.type' "button", HA.id authActionId, HA.class' "sp-btn sp-btn-secondary", HA.onClick Logout ] [ icon "logout", HE.text "ログアウト" ])
        Failed (ProfileUnavailable _) -> notice "auth-notice" "profile-unavailable" false "warn"
          "選んでいた Profile が使えなくなりました。Profile を選び直してください。"
          ( HE.button
              [ HA.type' "button"
              , HA.id authActionId
              , HA.class' "sp-btn sp-btn-secondary"
              -- The menu returns focus here (its opener) unless choosing a Profile
              -- resolved the notice; then focus goes to the header switcher.
              , HA.onClick (ToggleProfileMenu authActionId)
              , attr "aria-haspopup" (if model.isMobile then "dialog" else "menu")
              , attr "aria-expanded" (if isJust model.profileMenu then "true" else "false")
              ]
              [ HE.text "Profile を選ぶ" ]
          )
        _ -> notice "auth-notice" "signed-out" false "login"
          "ログインしていません。投稿や Profile の切り替えにはログインが必要です。"
          loginButton
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
