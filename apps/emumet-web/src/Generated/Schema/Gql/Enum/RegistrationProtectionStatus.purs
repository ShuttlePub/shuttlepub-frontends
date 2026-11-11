module Generated.Schema.Gql.Enum.RegistrationProtectionStatus where

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

-- | 現在時刻での評価。OPERATIONAL は現在の設定に結び付いた実検証の成功が新鮮な間だけ
data RegistrationProtectionStatus
  = CONFIGURATION_INVALID
  | OPERATIONAL
  | TEMPORARILY_UNAVAILABLE
  | UNVERIFIED

instance eqRegistrationProtectionStatus :: Eq RegistrationProtectionStatus where
  eq = eq `on` show

instance ordRegistrationProtectionStatus :: Ord RegistrationProtectionStatus where
  compare = compare `on` show

instance gqlArgStringRegistrationProtectionStatus :: GqlArgString RegistrationProtectionStatus where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationProtectionStatus :: DecodeJson RegistrationProtectionStatus where
  decodeJson = decodeJson >=> case _ of
    "CONFIGURATION_INVALID" -> pure CONFIGURATION_INVALID
    "OPERATIONAL" -> pure OPERATIONAL
    "TEMPORARILY_UNAVAILABLE" -> pure TEMPORARILY_UNAVAILABLE
    "UNVERIFIED" -> pure UNVERIFIED
    s -> Left $ TypeMismatch $ "Not a RegistrationProtectionStatus: " <> s

instance encodeJsonRegistrationProtectionStatus :: EncodeJson RegistrationProtectionStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationProtectionStatus :: DecodeHasura RegistrationProtectionStatus where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationProtectionStatus :: EncodeHasura RegistrationProtectionStatus where
  encodeHasura = encodeJson

instance showRegistrationProtectionStatus :: Show RegistrationProtectionStatus where
  show a = case a of
    CONFIGURATION_INVALID -> "CONFIGURATION_INVALID"
    OPERATIONAL -> "OPERATIONAL"
    TEMPORARILY_UNAVAILABLE -> "TEMPORARILY_UNAVAILABLE"
    UNVERIFIED -> "UNVERIFIED"

instance enumRegistrationProtectionStatus :: Enum RegistrationProtectionStatus where
  succ a = case a of
    CONFIGURATION_INVALID -> Just OPERATIONAL
    OPERATIONAL -> Just TEMPORARILY_UNAVAILABLE
    TEMPORARILY_UNAVAILABLE -> Just UNVERIFIED
    UNVERIFIED -> Nothing
  pred a = case a of
    CONFIGURATION_INVALID -> Nothing
    OPERATIONAL -> Just CONFIGURATION_INVALID
    TEMPORARILY_UNAVAILABLE -> Just OPERATIONAL
    UNVERIFIED -> Just TEMPORARILY_UNAVAILABLE

instance boundedRegistrationProtectionStatus :: Bounded RegistrationProtectionStatus where
  top = UNVERIFIED
  bottom = CONFIGURATION_INVALID

instance boundedEnumRegistrationProtectionStatus :: BoundedEnum RegistrationProtectionStatus where
  cardinality = Cardinality 4
  toEnum a = case a of
    0 -> Just CONFIGURATION_INVALID
    1 -> Just OPERATIONAL
    2 -> Just TEMPORARILY_UNAVAILABLE
    3 -> Just UNVERIFIED
    _ -> Nothing
  fromEnum a = case a of
    CONFIGURATION_INVALID -> 0
    OPERATIONAL -> 1
    TEMPORARILY_UNAVAILABLE -> 2
    UNVERIFIED -> 3

