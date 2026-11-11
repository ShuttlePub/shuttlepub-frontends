module Generated.Schema.Gql.Enum.RegistrationProtectionVerifyOutcome where

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

data RegistrationProtectionVerifyOutcome
  = BUSINESS_SUCCESS
  | ACCEPTED
  | CONFIGURATION_INVALID
  | ATTEMPT_REJECTED
  | TEMPORARILY_UNAVAILABLE

instance eqRegistrationProtectionVerifyOutcome :: Eq RegistrationProtectionVerifyOutcome where
  eq = eq `on` show

instance ordRegistrationProtectionVerifyOutcome :: Ord RegistrationProtectionVerifyOutcome where
  compare = compare `on` show

instance gqlArgStringRegistrationProtectionVerifyOutcome :: GqlArgString RegistrationProtectionVerifyOutcome where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationProtectionVerifyOutcome :: DecodeJson RegistrationProtectionVerifyOutcome where
  decodeJson = decodeJson >=> case _ of
    "BUSINESS_SUCCESS" -> pure BUSINESS_SUCCESS
    "ACCEPTED" -> pure ACCEPTED
    "CONFIGURATION_INVALID" -> pure CONFIGURATION_INVALID
    "ATTEMPT_REJECTED" -> pure ATTEMPT_REJECTED
    "TEMPORARILY_UNAVAILABLE" -> pure TEMPORARILY_UNAVAILABLE
    s -> Left $ TypeMismatch $ "Not a RegistrationProtectionVerifyOutcome: " <> s

instance encodeJsonRegistrationProtectionVerifyOutcome :: EncodeJson RegistrationProtectionVerifyOutcome where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationProtectionVerifyOutcome :: DecodeHasura RegistrationProtectionVerifyOutcome where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationProtectionVerifyOutcome :: EncodeHasura RegistrationProtectionVerifyOutcome where
  encodeHasura = encodeJson

instance showRegistrationProtectionVerifyOutcome :: Show RegistrationProtectionVerifyOutcome where
  show a = case a of
    BUSINESS_SUCCESS -> "BUSINESS_SUCCESS"
    ACCEPTED -> "ACCEPTED"
    CONFIGURATION_INVALID -> "CONFIGURATION_INVALID"
    ATTEMPT_REJECTED -> "ATTEMPT_REJECTED"
    TEMPORARILY_UNAVAILABLE -> "TEMPORARILY_UNAVAILABLE"

instance enumRegistrationProtectionVerifyOutcome :: Enum RegistrationProtectionVerifyOutcome where
  succ a = case a of
    BUSINESS_SUCCESS -> Just ACCEPTED
    ACCEPTED -> Just CONFIGURATION_INVALID
    CONFIGURATION_INVALID -> Just ATTEMPT_REJECTED
    ATTEMPT_REJECTED -> Just TEMPORARILY_UNAVAILABLE
    TEMPORARILY_UNAVAILABLE -> Nothing
  pred a = case a of
    BUSINESS_SUCCESS -> Nothing
    ACCEPTED -> Just BUSINESS_SUCCESS
    CONFIGURATION_INVALID -> Just ACCEPTED
    ATTEMPT_REJECTED -> Just CONFIGURATION_INVALID
    TEMPORARILY_UNAVAILABLE -> Just ATTEMPT_REJECTED

instance boundedRegistrationProtectionVerifyOutcome :: Bounded RegistrationProtectionVerifyOutcome where
  top = TEMPORARILY_UNAVAILABLE
  bottom = BUSINESS_SUCCESS

instance boundedEnumRegistrationProtectionVerifyOutcome :: BoundedEnum RegistrationProtectionVerifyOutcome where
  cardinality = Cardinality 5
  toEnum a = case a of
    0 -> Just BUSINESS_SUCCESS
    1 -> Just ACCEPTED
    2 -> Just CONFIGURATION_INVALID
    3 -> Just ATTEMPT_REJECTED
    4 -> Just TEMPORARILY_UNAVAILABLE
    _ -> Nothing
  fromEnum a = case a of
    BUSINESS_SUCCESS -> 0
    ACCEPTED -> 1
    CONFIGURATION_INVALID -> 2
    ATTEMPT_REJECTED -> 3
    TEMPORARILY_UNAVAILABLE -> 4

