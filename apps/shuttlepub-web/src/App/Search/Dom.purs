module App.Search.Dom (Segment, highlightSegments, trackSearchSentinel, inputValue) where

import Prelude (Unit)

import Effect (Effect)
import Web.Event.Event (Event)

-- | A piece of a note's text: a hit is where the keyword matches.
type Segment = { text :: String, hit :: Boolean }

-- | keyword -> text -> pieces (case and width insensitive; see Dom.js).
foreign import highlightSegments :: String -> String -> Array Segment

-- | The value of the input an event came from (composition end carries no data of its own).
foreign import inputValue :: Event -> Effect String

-- | Calls back when the next-page sentinel comes near the viewport (Dom.js).
foreign import trackSearchSentinel :: Effect Unit -> Effect Unit
