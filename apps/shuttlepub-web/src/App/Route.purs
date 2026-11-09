module App.Route where

import Prelude

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Show.Generic (genericShow)
import Routing.Duplex (RouteDuplex', root)
import Routing.Duplex.Generic (noArgs, sum)

-- | Routing skeleton. Only the root exists: the screen structure (which routes
-- | there are and how they look) is decided with the mock agreement, not here.
-- | New routes are added as constructors plus a codec entry below.
data Route = Home

derive instance Generic Route _
derive instance Eq Route

instance Show Route where
  show = genericShow

instance EncodeJson Route where
  encodeJson = genericEncodeJson

instance DecodeJson Route where
  decodeJson = genericDecodeJson

-- | Unknown paths parse to Nothing, which the view maps to the shared NotFound.
routeCodec :: RouteDuplex' Route
routeCodec = root $ sum
  { "Home": noArgs
  }
