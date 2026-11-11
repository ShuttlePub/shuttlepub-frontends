module Client where

import Prelude

import App.Dom (isMobileViewport, nowMillis, onViewportChange)
import App.Message (Message(..))
import App.Reaction (ReactionMsg(..))
import App.ReactionDom (onPageRestored, trackFocus)
import App.Route (routeCodec)
import App.View (view)
import Client.Update (mkUpdate)
import Data.Either (hush)
import Data.Maybe (Maybe)
import Effect (Effect)
import Flame (AppId(..), resumeMount)
import Flame.Subscription (send)
import Flame.Subscription.Document as Document
import Routing.Duplex (parse)
import Routing.PushState (makeInterface, paths)
import Web.DOM.ParentNode (QuerySelector(..))

appId :: AppId String Message
appId = AppId "shuttlepub-web"

main :: Effect Unit
main = do
  nav <- makeInterface

  _model <- resumeMount (QuerySelector "main#app") appId
    { view
    , update: mkUpdate nav
    -- Keys pressed inside the app are handled by the shell's own keydown handler
    -- (which stops propagation); this only sees Escape with focus outside the app.
    , subscribe: [ Document.onKeydown \key -> if key == "Escape" then DocumentEscape else NoOp ]
    }

  trackFocus
  now <- nowMillis
  isMobile <- isMobileViewport
  send appId (Hydrated now isMobile)
  onViewportChange \mobile -> send appId (ViewportChanged mobile)
  onPageRestored (send appId (Reaction PageRestoring)) (send appId (Reaction PageRestored))

  void $ paths handlePath nav
  where
  handlePath :: Maybe String -> String -> Effect Unit
  handlePath _old new = send appId (UrlChanged (hush $ parse routeCodec new))
