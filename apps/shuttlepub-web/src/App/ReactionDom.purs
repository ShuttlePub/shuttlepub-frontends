-- | Browser helpers of the quick reaction UI (see ReactionDom.js).
module App.ReactionDom
  ( setPendingRemoval
  , clearPendingRemoval
  , leavesClosest
  , startDrag
  , blurTarget
  , focusIfLost
  , onPageRestored
  ) where

import Prelude

import Effect (Effect)
import Web.Event.Event (Event)

-- | Remember the removal to send with keepalive if the page goes away first (D03 q09).
foreign import setPendingRemoval :: String -> String -> Effect Unit
foreign import clearPendingRemoval :: Effect Unit
foreign import leavesClosest :: String -> Event -> Effect Boolean
foreign import startDrag :: Event -> Effect Unit
foreign import blurTarget :: Event -> Effect Unit
foreign import focusIfLost :: String -> Effect Unit
foreign import onPageRestored :: Effect Unit -> Effect Unit -> Effect Unit
