module App.View where

import Prelude

import App.Api.Error as Error
import App.Message (Message)
import App.Model (Model, RemoteData(..))
import App.Route (Route(..))
import Data.Maybe (Maybe(..), maybe)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))
import ShuttlePub.UI.Layout as UI.Layout
import ShuttlePub.UI.NotFound as NotFound

-- | Foundation placeholder: a plain heading plus the raw state of each data
-- | source, so the SSR -> hydration -> BFF path can be verified. It carries no
-- | layout or design decisions; the real screens follow the mock agreement.
-- |
-- | Every element keeps a stable shape (one non-empty text node per row):
-- | Flame's resumeMount matches SSR DOM and virtual nodes by index only.
view :: Model -> Html Message
view model = UI.Layout.shell
  [ UI.Layout.contentArea
      [ case model.route of
          Just Home -> home model
          Nothing -> NotFound.notFound
      ]
  ]

home :: Model -> Html Message
home model =
  HE.div_
    [ HE.h1_ [ HE.text "ShuttlePub" ]
    , HE.ul_
        [ row "hydration-state" "Client" (if model.isHydrated then "hydrated" else "ssr") (if model.isHydrated then "hydrated" else "ssr")
        , remoteRow "api-mode" "API mode" showMode model.apiMode
        , remoteRow "api-status" "API status" _.apiVersion model.apiStatus
        , remoteRow "profile-context" "Active profile" showProfile model.profileContext
        ]
    ]
  where
  showMode = case _ of
    MOCK -> "mock"
    REAL -> "real"
  showProfile context = maybe "none" (\profile -> profile.displayName <> " (@" <> profile.handle <> ")") context.activeProfile

remoteRow :: forall a. String -> String -> (a -> String) -> RemoteData a -> Html Message
remoteRow testId label render = case _ of
  NotAsked -> row testId label "loading" "Loading"
  Loading -> row testId label "loading" "Loading"
  Failed error -> rowWithError testId label error
  Loaded value -> row testId label "loaded" (render value)

row :: String -> String -> String -> String -> Html Message
row testId label state value =
  HE.li
    [ HA.createAttribute "data-testid" testId
    , HA.createAttribute "data-state" state
    ]
    [ HE.text (label <> ": " <> value) ]

rowWithError :: String -> String -> Error.ApiError -> Html Message
rowWithError testId label error =
  HE.li
    [ HA.createAttribute "data-testid" testId
    , HA.createAttribute "data-state" "error"
    , HA.createAttribute "data-error" (Error.tag error)
    ]
    [ HE.text (label <> ": " <> Error.describe error) ]
