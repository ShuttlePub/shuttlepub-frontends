module App.MuteBlock.Dom (focusLater, localDate, reloadPage) where

import Prelude

import Effect (Effect)

-- | Focus the first existing element of these ids once the DOM has been patched.
foreign import focusLater :: Array String -> Effect Unit

-- | "YYYY/MM/DD" of an ISO-8601 timestamp in the viewer's time zone.
foreign import localDate :: String -> String

-- | Reload the page (the selected Profile or the session changed).
foreign import reloadPage :: Effect Unit
