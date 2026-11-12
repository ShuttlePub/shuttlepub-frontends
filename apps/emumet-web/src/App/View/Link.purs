module App.View.Link where

import Prelude

import App.Message (Message(..))
import App.Route (Route, routeCodec)
import Data.Maybe (Maybe(..))
import Effect (Effect)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Routing.Duplex (print)
import ShuttlePub.UI.Link as UI.Link
import Web.Event.Event (Event, preventDefault)

link :: Route -> Array (Html Message) -> Html Message
link route children =
  UI.Link.navLink (print routeCodec route) (Navigate route) children

-- | A navigating link without the navigation bar's padding and hover colours (the shared nav style stays
-- | untouched): for cards and buttons that carry their own spacing.
plainLink :: String -> Route -> Array (Html Message) -> Html Message
plainLink cls route children =
  HE.a
    [ HA.href (print routeCodec route)
    , HA.class' cls
    , HA.createRawEvent "click" handler
    ]
    children
  where
  handler :: Event -> Effect (Maybe Message)
  handler event = do
    preventDefault event
    pure (Just (Navigate route))
