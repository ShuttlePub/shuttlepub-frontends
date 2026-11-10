module App.Model where

import Prelude

import App.Api.Error (ApiError)
import App.Profile (ProfileContext)
import App.Route (Route)
import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Either (Either(..))
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)

data RemoteData a
  = NotAsked
  | Loading
  | Failed ApiError
  | Loaded a

derive instance Generic (RemoteData a) _
derive instance Eq a => Eq (RemoteData a)

instance Show a => Show (RemoteData a) where
  show = genericShow

instance EncodeJson a => EncodeJson (RemoteData a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (RemoteData a) where
  decodeJson = genericDecodeJson

fromEither :: forall a. Either ApiError a -> RemoteData a
fromEither = case _ of
  Left error -> Failed error
  Right value -> Loaded value

type ApiStatus =
  { apiVersion :: String
  }

-- | Record encode/decode instances come from argonaut-codecs, so the Flame
-- | serialized state round-trips without hand-written instances.
type Model =
  { route :: Maybe Route
  , isHydrated :: Boolean
  , apiMode :: RemoteData ApiMode
  , apiStatus :: RemoteData ApiStatus
  , profileContext :: RemoteData ProfileContext
  }

-- | Initial model used by SSR (and as the base for tests). Data is requested by
-- | the client after hydration, so SSR never claims to know it.
initialModel :: Maybe Route -> Model
initialModel route =
  { route
  , isHydrated: false
  , apiMode: NotAsked
  , apiStatus: NotAsked
  , profileContext: NotAsked
  }
