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
  -- 管理画面 (管理者のみ。導線は管理者にだけ出し、非管理者には 404 を表示する)
  | AdminRegistration
  | AdminWebhook

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
  , "AdminRegistration": "admin" / prefix "registration" noArgs
  , "AdminWebhook": "admin" / prefix "webhook" noArgs
  }

-- | 管理画面の Route か (強制開放中の警告帯はこの範囲にだけ出す)
isAdminRoute :: Route -> Boolean
isAdminRoute = case _ of
  AdminRegistration -> true
  AdminWebhook -> true
  _ -> false
