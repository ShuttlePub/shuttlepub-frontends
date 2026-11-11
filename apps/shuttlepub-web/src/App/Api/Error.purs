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
  = Unauthenticated String
  -- | Unauthenticated because the session the browser held is no longer usable
  -- | (BFF extensions.reason = SESSION_EXPIRED). The BFF has already cleared it.
  | SessionExpired String
  | Forbidden String
  | ProfileUnavailable String
  | NotImplemented String
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
  Just "UNAUTHENTICATED" -> Unauthenticated message
  Just "FORBIDDEN" -> Forbidden message
  Just "PROFILE_UNAVAILABLE" -> ProfileUnavailable message
  Just "NOT_IMPLEMENTED" -> NotImplemented message
  Just "UPSTREAM_ERROR" -> UpstreamError message
  Just "UPSTREAM_UNAVAILABLE" -> Unavailable message
  Just "INVALID_UPSTREAM_RESPONSE" -> InvalidResponse message
  _ -> Unexpected message

-- | Refines an error with the BFF's `extensions.reason` (bff/auth-error.ts AuthErrorReason).
-- | Only an expiry of an UNAUTHENTICATED error is recognised; anything else is kept as is.
withReason :: Maybe String -> ApiError -> ApiError
withReason reason error = case reason, error of
  Just "SESSION_EXPIRED", Unauthenticated message -> SessionExpired message
  _, _ -> error

-- | The viewer has no usable session (never logged in, logged out or expired).
isSignedOut :: ApiError -> Boolean
isSignedOut = case _ of
  Unauthenticated _ -> true
  SessionExpired _ -> true
  _ -> false

describe :: ApiError -> String
describe = case _ of
  Unauthenticated _ -> "Login required"
  SessionExpired _ -> "Login expired"
  Forbidden _ -> "Access denied"
  ProfileUnavailable _ -> "Selected profile is no longer available"
  NotImplemented message -> "Not implemented: " <> message
  UpstreamError message -> "Backend error: " <> message
  Unavailable message -> "Backend unavailable: " <> message
  InvalidResponse message -> "Invalid backend response: " <> message
  NetworkError message -> "Network error: " <> message
  Unexpected message -> "Unexpected error: " <> message

-- | Stable machine-readable tag for tests and styling hooks.
tag :: ApiError -> String
tag = case _ of
  Unauthenticated _ -> "unauthenticated"
  SessionExpired _ -> "session_expired"
  Forbidden _ -> "forbidden"
  ProfileUnavailable _ -> "profile_unavailable"
  NotImplemented _ -> "not_implemented"
  UpstreamError _ -> "upstream_error"
  Unavailable _ -> "unavailable"
  InvalidResponse _ -> "invalid_response"
  NetworkError _ -> "network_error"
  Unexpected _ -> "unexpected"
