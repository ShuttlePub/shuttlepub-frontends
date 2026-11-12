module App.View.Common
  ( attr
  , testId
  , emptySlot
  , visuallyHidden
  , icon
  , avatar
  , AvatarSize(..)
  , routeLink
  , routeHref
  , loginHref
  , onPlainClick
  , stateNote
  , errorNote
  ) where

import Prelude

import App.Api.Error as Error
import App.Dom (avatarColor, encodeQueryComponent, initialOf, isPlainClick, preventDefault)
import App.Message (Message(..))
import App.Route (Route(..), routeCodec)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Flame.Types (NodeData)
import Routing.Duplex (print)

attr :: forall msg. String -> String -> NodeData msg
attr = HA.createAttribute

testId :: forall msg. String -> NodeData msg
testId = attr "data-testid"

-- | Keep a real DOM node for every conditional SSR slot; empty text disappears
-- | during HTML parsing and shifts Flame resumeMount's positional child mapping.
emptySlot :: forall msg. Html msg
emptySlot = HE.span [ HA.hidden true ] []

visuallyHidden :: forall msg. String -> Html msg
visuallyHidden text = HE.span [ HA.class' "sp-visually-hidden" ] [ HE.text text ]

-- | Outline icons (24px viewBox, stroke = currentColor), the set used by the agreed mock.
icon :: forall msg. String -> Html msg
icon kind = HE.svg
  [ HA.viewBox "0 0 24 24"
  , HA.fill "none"
  , HA.stroke "currentColor"
  , HA.strokeWidth (if kind == "more" then "2.8" else "1.6")
  , attr "aria-hidden" "true"
  , HA.class' ("sp-icon sp-icon-" <> kind)
  ]
  [ HE.path [ HA.d path, HA.strokeLinecap "round", HA.strokeLinejoin "round" ] [] ]
  where
  path = case kind of
    "home" -> "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"
    "bell" -> "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4Zm4 4h4"
    "search" -> "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
    "bookmark" -> "M6 3h12v18l-6-4-6 4Z"
    "settings" -> "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4"
    "reply" -> "M10 8 4 13l6 5M4 13h11a5 5 0 0 1 5 5v1"
    "repost" -> "M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4"
    "react" -> "M20.5 12A8.5 8.5 0 1 1 13 3.6M9 10h.01M15 10h.01M8.5 14.5a4.6 4.6 0 0 0 7 0M19 2.5v6M16 5.5h6"
    "more" -> "M5 12h.01M12 12h.01M19 12h.01"
    "chevdown" -> "m6 9 6 6 6-6"
    "back" -> "M15 5l-7 7 7 7"
    "close" -> "m6 6 12 12M6 18 18 6"
    "check" -> "m4 12 5 5L20 6"
    "image" -> "M4 5h16v14H4ZM4 16l5-5 4 4 3-3 4 4M15 9h.01"
    "eye" -> "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6"
    "lock" -> "M6 11h12v10H6ZM8 11V8a4 4 0 0 1 8 0v3"
    "mail" -> "M3 6h18v12H3ZM3 7l9 6 9-6"
    "pencil" -> "M4 20h4L19 9l-4-4L4 16Z"
    "globe" -> "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"
    "logout" -> "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"
    "login" -> "M9 4H5v16h4M14 8l4 4-4 4M18 12H7"
    "warn" -> "M12 3 2 21h20ZM12 10v5M12 18h.01"
    "eyeoff" -> "M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.1 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"
    "block" -> "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8"
    "userx" -> "M15 19a6 6 0 0 0-12 0M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 8l5 5M22 8l-5 5"
    _ -> "M12 12h.01"

data AvatarSize = AvatarRegular | AvatarSmall | AvatarTiny | AvatarLarge

-- | Letter avatar (no image fixtures yet), decorative: names are always shown as text.
avatar :: forall msg r. AvatarSize -> { id :: String, displayName :: String | r } -> Html msg
avatar size who = HE.span
  [ HA.class' ("sp-avatar" <> sizeClass)
  , HA.style { background: avatarColor who.id }
  , attr "aria-hidden" "true"
  ]
  [ HE.text (initialOf who.displayName) ]
  where
  sizeClass = case size of
    AvatarRegular -> ""
    AvatarSmall -> " sp-avatar-sm"
    AvatarTiny -> " sp-avatar-xs"
    AvatarLarge -> " sp-avatar-lg"

routeHref :: Route -> String
routeHref = print routeCodec

-- | Starts the OIDC login (bff/auth.ts, a plain navigation that leaves the app) and
-- | comes back to the current screen. The BFF re-validates return_to (safeAppReturnTo).
-- | Home, the login screen itself and unknown paths return to "/".
loginHref :: Maybe Route -> String
loginHref = case _ of
  Just Home -> start
  Just (Login _) -> start
  Nothing -> start
  Just route -> start <> "?return_to=" <> encodeQueryComponent (routeHref route)
  where
  start = "/auth/login"

-- | A real link (works without JS and with modifier keys) that navigates in-app on a
-- | plain click.
routeLink :: Route -> Array (NodeData Message) -> Array (Html Message) -> Html Message
routeLink route attributes children = HE.a
  ([ HA.href (routeHref route), onPlainClick (Navigate route) ] <> attributes)
  children

onPlainClick :: Message -> NodeData Message
onPlainClick message = HA.createRawEvent "click" \event -> do
  plain <- isPlainClick event
  if plain then preventDefault event $> Just message else pure Nothing

-- | Neutral inline state ("読み込み中…", empty lists). testid/state let tests find it.
stateNote :: forall msg. String -> String -> String -> Html msg
stateNote id state text = HE.p
  [ HA.class' "sp-state", testId id, attr "data-state" state ]
  [ HE.text text ]

-- | A failed request, shown as such (never replaced by data).
errorNote :: forall msg. String -> String -> Error.ApiError -> Html msg
errorNote id lead error = HE.p
  [ HA.class' "sp-state sp-state-error"
  , testId id
  , attr "data-state" "error"
  , attr "data-error" (Error.tag error)
  , attr "role" "status"
  ]
  [ HE.text (lead <> "（" <> Error.describe error <> "）") ]
