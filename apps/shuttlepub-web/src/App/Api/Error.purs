module App.Api.Error where

import Prelude

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Show.Generic (genericShow)

-- | Why a data request failed. Every constructor is shown to the viewer as an
-- | error; none of them is ever turned into data (no silent fallback to mock).
data ApiError
  = NotImplemented String
  | UpstreamError String
  | Unavailable String
  | InvalidResponse String
  | NetworkError String
  | Unexpected String

derive instance Generic ApiError _
derive instance Eq ApiError

instance Show ApiError where
  show = genericShow

instance EncodeJson ApiError where
  encodeJson = genericEncodeJson

instance DecodeJson ApiError where
  decodeJson = genericDecodeJson

-- | Maps the BFF's GraphQL `extensions.code` (bff/resolvers.ts ERROR_CODES).
fromGqlCode :: Maybe String -> String -> ApiError
fromGqlCode code message = case code of
  Just "NOT_IMPLEMENTED" -> NotImplemented message
  Just "UPSTREAM_ERROR" -> UpstreamError message
  Just "UPSTREAM_UNAVAILABLE" -> Unavailable message
  Just "INVALID_UPSTREAM_RESPONSE" -> InvalidResponse message
  _ -> Unexpected message

describe :: ApiError -> String
describe = case _ of
  NotImplemented message -> "Not implemented: " <> message
  UpstreamError message -> "Backend error: " <> message
  Unavailable message -> "Backend unavailable: " <> message
  InvalidResponse message -> "Invalid backend response: " <> message
  NetworkError message -> "Network error: " <> message
  Unexpected message -> "Unexpected error: " <> message

-- | Stable machine-readable tag for tests and styling hooks.
tag :: ApiError -> String
tag = case _ of
  NotImplemented _ -> "not_implemented"
  UpstreamError _ -> "upstream_error"
  Unavailable _ -> "unavailable"
  InvalidResponse _ -> "invalid_response"
  NetworkError _ -> "network_error"
  Unexpected _ -> "unexpected"
