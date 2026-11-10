module Generated.Schema.Gql.Enum.RegistrationProbeStatus where

import Prelude

import Data.Argonaut.Decode (class DecodeJson, JsonDecodeError(..), decodeJson)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Bounded (class Bounded)
import Data.Enum (class Enum, class BoundedEnum, Cardinality(..))
import Data.Either (Either(..))
import Data.Function (on)
import Data.Maybe (Maybe(..))
import GraphQL.Client.ToGqlString (class GqlArgString)
import GraphQL.Hasura.Decode (class DecodeHasura)
import GraphQL.Hasura.Encode (class EncodeHasura)

data RegistrationProbeStatus
  = HEALTHY
  | UNHEALTHY
  | UNKNOWN

instance eqRegistrationProbeStatus :: Eq RegistrationProbeStatus where
  eq = eq `on` show

instance ordRegistrationProbeStatus :: Ord RegistrationProbeStatus where
  compare = compare `on` show

instance gqlArgStringRegistrationProbeStatus :: GqlArgString RegistrationProbeStatus where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationProbeStatus :: DecodeJson RegistrationProbeStatus where
  decodeJson = decodeJson >=> case _ of
    "HEALTHY" -> pure HEALTHY
    "UNHEALTHY" -> pure UNHEALTHY
    "UNKNOWN" -> pure UNKNOWN
    s -> Left $ TypeMismatch $ "Not a RegistrationProbeStatus: " <> s

instance encodeJsonRegistrationProbeStatus :: EncodeJson RegistrationProbeStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationProbeStatus :: DecodeHasura RegistrationProbeStatus where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationProbeStatus :: EncodeHasura RegistrationProbeStatus where
  encodeHasura = encodeJson

instance showRegistrationProbeStatus :: Show RegistrationProbeStatus where
  show a = case a of
    HEALTHY -> "HEALTHY"
    UNHEALTHY -> "UNHEALTHY"
    UNKNOWN -> "UNKNOWN"

instance enumRegistrationProbeStatus :: Enum RegistrationProbeStatus where
  succ a = case a of
    HEALTHY -> Just UNHEALTHY
    UNHEALTHY -> Just UNKNOWN
    UNKNOWN -> Nothing
  pred a = case a of
    HEALTHY -> Nothing
    UNHEALTHY -> Just HEALTHY
    UNKNOWN -> Just UNHEALTHY

instance boundedRegistrationProbeStatus :: Bounded RegistrationProbeStatus where
  top = UNKNOWN
  bottom = HEALTHY

instance boundedEnumRegistrationProbeStatus :: BoundedEnum RegistrationProbeStatus where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just HEALTHY
    1 -> Just UNHEALTHY
    2 -> Just UNKNOWN
    _ -> Nothing
  fromEnum a = case a of
    HEALTHY -> 0
    UNHEALTHY -> 1
    UNKNOWN -> 2

