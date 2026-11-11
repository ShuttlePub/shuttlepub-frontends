module Server where

import Prelude

import App.Fixtures (fixtures)
import App.Message (Message)
import App.Model (Model, RemoteData(..), emptyNewAccountForm, pageForMaybeRoute)
import App.Route (routeCodec)
import App.View (view)
import ShuttlePub.UI.Layout as UI.Layout
import Data.Array (find)
import Data.Either (hush)
import Data.Maybe (Maybe(..))
import Effect (Effect)
import Effect.Exception (throw)
import Flame.Application.Internal.PreMount (injectState, tagSerializedState, idSerializedState, attributeSerializedState, onlyLetters)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Flame.Renderer.String as FRS
import Flame.Serialization as FS
import Flame.Types (Html)
import Routing.Duplex (parse)

selector :: String
selector = "main#app"

renderPage :: String -> Effect String
renderPage urlPath = do
  let
    mRoute = hush $ parse routeCodec urlPath
    page = pageForMaybeRoute mRoute
    model = { route: mRoute, page, isHydrated: false, session: Nothing, loginForm: { identifier: "", password: "" }, accounts: NotAsked, selectedAccount: NotAsked, newAccountForm: emptyNewAccountForm, editProfileForm: Nothing, editMetadataForm: Nothing, setUsernameDialog: Nothing, instanceHost: NotAsked, errorMessage: Nothing, savePending: false, saveGeneration: 0 }
  renderModel model

-- | The SSR page (HTML + serialized state) for any state of the app.
renderModel :: Model -> Effect String
renderModel model = do
  let
    appView = view model
    stateEl = mkStateElement model
    withState = injectState stateEl appView
    fullDoc = UI.Layout.document "Ratcap" withState
  FRS.render fullDoc

-- | The states the hydration check serves (see App.Fixtures): id and the URL each belongs to.
fixtureList :: Array { id :: String, path :: String }
fixtureList = map (\f -> { id: f.id, path: f.path }) fixtures

renderFixture :: String -> Effect String
renderFixture id = case find (\f -> f.id == id) fixtures of
  Just f -> renderModel f.model
  Nothing -> throw ("unknown fixture: " <> id)

mkStateElement :: Model -> Html Message
mkStateElement model =
  HE.createElement tagSerializedState
    [ HA.style { display: "none" }
    , HA.id $ idSerializedState sanitizedSelector
    , HA.createAttribute (attributeSerializedState sanitizedSelector) sanitizedSelector
    ]
    [ HE.text $ FS.serialize model ]
  where
  sanitizedSelector = onlyLetters selector
