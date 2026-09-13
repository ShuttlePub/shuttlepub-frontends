module App.Route where

import Prelude hiding ((/))

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Show.Generic (genericShow)
import Routing.Duplex (RouteDuplex', prefix, root, segment)
import Routing.Duplex.Generic (noArgs, sum)

data Route
  = Login
  | Drive
  | FileDetail String

derive instance Generic Route _
derive instance Eq Route

instance Show Route where
  show = genericShow

instance EncodeJson Route where
  encodeJson = genericEncodeJson

instance DecodeJson Route where
  decodeJson = genericDecodeJson

-- | The root path "/" is not part of the codec: the client redirects it to
-- | /drive (see Client.purs), and any other unknown path parses to Nothing,
-- | which the view maps to the NotFound page.
routeCodec :: RouteDuplex' Route
routeCodec = root $ sum
  { "Login": prefix "login" noArgs
  , "Drive": prefix "drive" noArgs
  , "FileDetail": prefix "drive" (prefix "files" segment)
  }
