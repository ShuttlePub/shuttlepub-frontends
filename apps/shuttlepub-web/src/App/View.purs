module App.View where

import Prelude

import App.Api.Error as Error
import App.Dom (keydownAction)
import App.Extension.Reaction as Reaction
import App.Message (Message(..))
import App.Model (Model, RemoteData(..))
import App.Route (Route(..))
import App.View.Common (attr, emptySlot, testId)
import App.View.Compose as Compose
import App.View.Pages as Pages
import App.View.Shell as Shell
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))
import ShuttlePub.UI.NotFound as NotFound

-- | The SNS shell (ui-spec v6, host intents/shuttlepub/features/quick-reaction-ui).
-- |
-- | SSR renders this with the initial model (no data); the client resumes the same
-- | DOM (Flame matches nodes by index, so conditional parts always keep a node, see
-- | App.View.Common.emptySlot) and then loads data.
view :: Model -> Html Message
view model = HE.main [ HA.id "app", HA.lang "ja" ]
  [ HE.div
      [ HA.class' "sp-app"
      , attr "data-hydration" (if model.isHydrated then "hydrated" else "ssr")
      , attr "data-api-mode" apiModeValue
      , testId "app-shell"
      -- The only keydown handler of the app (Flame runs just the nearest handler).
      , HA.createRawEvent "keydown" \event -> do
          action <- keydownAction event
          pure if action.action == "" then Nothing else Just (KeyPressed action)
      ]
      [ Shell.header model
      , HE.div [ HA.class' "sp-body" ]
          [ Shell.sidebar model
          , HE.div [ HA.id "content", HA.class' "sp-content" ]
              [ backendStatus model
              , page model
              ]
          ]
      , Shell.tabbar model
      , Shell.profileMenu model
      , Compose.compose model
      , Reaction.overlay model
      ]
  ]
  where
  apiModeValue = case model.apiMode of
    Loaded MOCK -> "mock"
    Loaded REAL -> "real"
    _ -> "unknown"

page :: Model -> Html Message
page model = case model.route of
  Just Home -> Pages.home model
  Just (PostDetail _) -> Pages.postDetail model
  Just Settings -> Pages.settings model
  Just Notifications -> Pages.placeholder "通知"
  Just Search -> Pages.placeholder "検索"
  Just Bookmarks -> Pages.placeholder "ブックマーク"
  Nothing -> HE.div [ HA.class' "sp-page sp-page-padded" ] [ NotFound.notFound ]

-- | The backend health check (GET /api/v1/status). A failure is shown as such;
-- | success needs no chrome, but keeps a marker node for tests.
backendStatus :: Model -> Html Message
backendStatus model = case model.apiStatus of
  Failed error -> HE.p
    [ HA.class' "sp-banner"
    , attr "role" "status"
    , testId "api-status"
    , attr "data-state" "error"
    , attr "data-error" (Error.tag error)
    ]
    [ HE.text ("バックエンドの状態を確認できません（" <> Error.describe error <> "）") ]
  Loaded status -> HE.span [ HA.hidden true, testId "api-status", attr "data-state" "loaded", attr "data-api-version" status.apiVersion ] []
  _ -> emptySlot
