module App.View.Common where

import Prelude

import App.Message (Message(..))
import App.Route (Route, routeCodec)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Routing.Duplex (print)
import Web.Event.Event (Event, preventDefault)

foreign import shouldFollowInApp :: Event -> Boolean

-- Keep a real DOM node for every conditional SSR slot; empty text disappears
-- during HTML parsing and shifts Flame resumeMount's positional child mapping.
emptySlot :: Html Message
emptySlot = HE.span [ HA.hidden true ] []

icon :: String -> Html Message
icon kind = HE.svg
  [ HA.viewBox "0 0 24 24"
  , HA.fill "none"
  , HA.stroke "currentColor"
  , HA.strokeWidth "1.6"
  , HA.createAttribute "aria-hidden" "true"
  , HA.class' ("drive-icon icon-" <> kind)
  ]
  [ HE.path [ HA.d path, HA.strokeLinecap "round", HA.strokeLinejoin "round" ] [] ]
  where
  path = case kind of
    "folder" -> "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"
    "upload" -> "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"
    "download" -> "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"
    "grid" -> "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z"
    "list" -> "M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"
    "search" -> "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
    "image" -> "M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M8 7h.1"
    "check" -> "m4 12 5 5L20 6"
    "chevron" -> "m9 5 7 7-7 7"
    "close" -> "m6 6 12 12M6 18 18 6"
    _ -> "M6 3h8l5 5v13H6ZM14 3v6h5M9 13h7M9 17h7"

routeLink :: String -> Route -> Array (Html Message) -> Html Message
routeLink className route children = HE.a
  [ HA.href (print routeCodec route)
  , HA.class' className
  , HA.createRawEvent "click" (\event -> if shouldFollowInApp event then preventDefault event $> Just (Navigate route) else pure Nothing)
  ]
  children

errorBanner :: Maybe String -> Html Message
errorBanner = case _ of
  Nothing -> emptySlot
  Just message -> HE.div [ HA.class' "drive-error", HA.createAttribute "role" "alert" ]
    [ HE.span_ [ HE.text message ]
    , HE.button [ HA.onClick DismissError, HA.class' "icon-button", HA.createAttribute "aria-label" "エラーを閉じる" ] [ icon "close" ]
    ]
