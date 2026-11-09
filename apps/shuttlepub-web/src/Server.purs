module Server where

import Prelude

import App.Message (Message)
import App.Model (Model, initialModel)
import App.Route (routeCodec)
import App.View (view)
import Data.Either (hush)
import Effect (Effect)
import Flame.Application.Internal.PreMount (attributeSerializedState, idSerializedState, injectState, onlyLetters, tagSerializedState)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Flame.Renderer.String as FRS
import Flame.Serialization as FS
import Flame.Types (Html)
import Routing.Duplex (parse)
import ShuttlePub.UI.Layout as UI.Layout

selector :: String
selector = "main#app"

-- | Full HTML document for a request path. The serialized model is embedded so
-- | the client resumes from exactly what the server rendered.
renderPage :: String -> Effect String
renderPage urlPath = do
  let
    model = initialModel (hush $ parse routeCodec urlPath)
    appView = view model
    stateEl = mkStateElement model
    withState = injectState stateEl appView
    fullDoc = UI.Layout.document "ShuttlePub" withState
  FRS.render fullDoc

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
