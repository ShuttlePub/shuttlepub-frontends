module Client where

import Prelude

import App.Admin.Types (AdminMsg(..))
import App.Message (Message(..))
import App.Route (routeCodec)
import App.View (view)
import Client.Update (mkUpdate)
import Data.Either (hush)
import Data.Maybe (Maybe)
import Effect (Effect)
import Flame (AppId(..), resumeMount)
import Flame.Subscription (send)
import Flame.Subscription.Document as FSD
import Routing.Duplex (parse)
import Routing.PushState (makeInterface, paths)
import Web.DOM.ParentNode (QuerySelector(..))

appId :: AppId String Message
appId = AppId "ratcap"

foreign import initThemeSelector :: Effect Unit

main :: Effect Unit
main = do
  nav <- makeInterface

  _model <- resumeMount (QuerySelector "main#app") appId
    { view, update: mkUpdate nav, subscribe: [ FSD.onKeydown (Admin <<< KeyPressed) ] }

  initThemeSelector

  -- Check session via BFF cookie (replaces sessionStorage-based InitAuth)
  send appId CheckSession

  void $ paths handlePath nav
  where
  handlePath :: Maybe String -> String -> Effect Unit
  handlePath _old new = send appId (UrlChanged (hush $ parse routeCodec new))
