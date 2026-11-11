module App.Route where

import Prelude hiding ((/))

import Data.Argonaut.Decode (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Routing.Duplex (RouteDuplex', root, prefix, segment)
import Routing.Duplex.Generic (noArgs, sum)
import Routing.Duplex.Generic.Syntax ((/))

data Route
  = Home
  | Login
  | Settings
  | AccountNew
  | AccountDetail String
  | UsernameHelp

derive instance Generic Route _
derive instance Eq Route

instance EncodeJson Route where
  encodeJson = genericEncodeJson

instance DecodeJson Route where
  decodeJson = genericDecodeJson

routeCodec :: RouteDuplex' Route
routeCodec = root $ sum
  { "Home": noArgs
  , "Login": prefix "login" noArgs
  , "Settings": prefix "settings" noArgs
  , "AccountNew": "accounts" / prefix "new" noArgs
  , "AccountDetail": "accounts" / segment
  , "UsernameHelp": "help" / prefix "username" noArgs
  }
