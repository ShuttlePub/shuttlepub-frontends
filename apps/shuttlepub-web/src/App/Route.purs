module App.Route where

import Prelude hiding ((/))

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)
import Routing.Duplex (RouteDuplex', optional, root, segment, string)
import Routing.Duplex.Generic (noArgs, sum)
import Routing.Duplex.Generic.Syntax ((/), (?))

-- | Screens of the SNS shell (ui-spec L3 navigation + L4 post detail).
-- | Notifications / Search / Bookmarks exist as navigation targets only; their
-- | contents are later units.
data Route
  = Home
  | Notifications
  | Search
  | Bookmarks
  | Settings
  | PostDetail String
  -- | Settings page "ミュート・ブロック" and its two sub-pages (D08 UI mock v5, ui-spec 1-2).
  | MuteBlockAccounts
  | MuteBlockDomains
  -- | The login entry (FA). The credentials form itself is the IdP's (Emumet);
  -- | `error` is the BFF callback's fixed failure reason (bff/auth.ts LOGIN_ERROR_PATHS).
  | Login { error :: Maybe String }

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
  , "Notifications": "notifications" / noArgs
  , "Search": "search" / noArgs
  , "Bookmarks": "bookmarks" / noArgs
  , "Settings": "settings" / noArgs
  , "PostDetail": "posts" / segment
  , "MuteBlockAccounts": "settings" / "mute-block" / "accounts" / noArgs
  , "MuteBlockDomains": "settings" / "mute-block" / "domains" / noArgs
  , "Login": "login" ? { error: optional <<< string }
  }
