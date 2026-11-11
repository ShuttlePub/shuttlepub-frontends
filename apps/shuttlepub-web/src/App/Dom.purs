module App.Dom
  ( KeyAction
  , focusById
  , focusFirstIn
  , keydownAction
  , isPlainClick
  , preventDefault
  , setScrollLock
  , nowMillis
  , isMobileViewport
  , onViewportChange
  , logoutAndReload
  , relativeTime
  , fullDateTime
  , initialOf
  , avatarColor
  , scrollToTop
  ) where

import Prelude

import Effect (Effect)
import Web.Event.Event (Event)

-- | Result of the app's single keydown handler (see Dom.js keydownAction).
-- | action: "" | "escape" | "tab". For "tab", list is the tablist's data-tablist and
-- | value the next tab's data-tab-value.
type KeyAction = { action :: String, list :: String, value :: String }

foreign import focusById :: String -> Effect Unit
foreign import focusFirstIn :: String -> Effect Unit
foreign import keydownAction :: Event -> Effect KeyAction
foreign import isPlainClick :: Event -> Effect Boolean
foreign import preventDefault :: Event -> Effect Unit
foreign import setScrollLock :: Boolean -> Effect Unit
foreign import nowMillis :: Effect Number
foreign import isMobileViewport :: Effect Boolean
foreign import onViewportChange :: (Boolean -> Effect Unit) -> Effect Unit
foreign import logoutAndReload :: Effect Unit
foreign import scrollToTop :: Effect Unit

-- | Pure formatting helpers (no DOM access; safe during SSR).
foreign import relativeTime :: Number -> String -> String
foreign import fullDateTime :: String -> String
foreign import initialOf :: String -> String
foreign import avatarColor :: String -> String
