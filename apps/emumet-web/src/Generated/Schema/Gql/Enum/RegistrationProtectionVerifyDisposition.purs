module Generated.Schema.Gql.Enum.RegistrationProtectionVerifyDisposition where

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

-- | COMPLETED / PENDING_CONFIRMATION (canary mailbox にコードを送った) / CANARY_NOT_CONFIGURED
data RegistrationProtectionVerifyDisposition
  = COMPLETED
  | PENDING_CONFIRMATION
  | CANARY_NOT_CONFIGURED

instance eqRegistrationProtectionVerifyDisposition :: Eq RegistrationProtectionVerifyDisposition where
  eq = eq `on` show

instance ordRegistrationProtectionVerifyDisposition :: Ord RegistrationProtectionVerifyDisposition where
  compare = compare `on` show

instance gqlArgStringRegistrationProtectionVerifyDisposition :: GqlArgString RegistrationProtectionVerifyDisposition where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationProtectionVerifyDisposition :: DecodeJson RegistrationProtectionVerifyDisposition where
  decodeJson = decodeJson >=> case _ of
    "COMPLETED" -> pure COMPLETED
    "PENDING_CONFIRMATION" -> pure PENDING_CONFIRMATION
    "CANARY_NOT_CONFIGURED" -> pure CANARY_NOT_CONFIGURED
    s -> Left $ TypeMismatch $ "Not a RegistrationProtectionVerifyDisposition: " <> s

instance encodeJsonRegistrationProtectionVerifyDisposition :: EncodeJson RegistrationProtectionVerifyDisposition where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationProtectionVerifyDisposition :: DecodeHasura RegistrationProtectionVerifyDisposition where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationProtectionVerifyDisposition :: EncodeHasura RegistrationProtectionVerifyDisposition where
  encodeHasura = encodeJson

instance showRegistrationProtectionVerifyDisposition :: Show RegistrationProtectionVerifyDisposition where
  show a = case a of
    COMPLETED -> "COMPLETED"
    PENDING_CONFIRMATION -> "PENDING_CONFIRMATION"
    CANARY_NOT_CONFIGURED -> "CANARY_NOT_CONFIGURED"

instance enumRegistrationProtectionVerifyDisposition :: Enum RegistrationProtectionVerifyDisposition where
  succ a = case a of
    COMPLETED -> Just PENDING_CONFIRMATION
    PENDING_CONFIRMATION -> Just CANARY_NOT_CONFIGURED
    CANARY_NOT_CONFIGURED -> Nothing
  pred a = case a of
    COMPLETED -> Nothing
    PENDING_CONFIRMATION -> Just COMPLETED
    CANARY_NOT_CONFIGURED -> Just PENDING_CONFIRMATION

instance boundedRegistrationProtectionVerifyDisposition :: Bounded RegistrationProtectionVerifyDisposition where
  top = CANARY_NOT_CONFIGURED
  bottom = COMPLETED

instance boundedEnumRegistrationProtectionVerifyDisposition :: BoundedEnum RegistrationProtectionVerifyDisposition where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just COMPLETED
    1 -> Just PENDING_CONFIRMATION
    2 -> Just CANARY_NOT_CONFIGURED
    _ -> Nothing
  fromEnum a = case a of
    COMPLETED -> 0
    PENDING_CONFIRMATION -> 1
    CANARY_NOT_CONFIGURED -> 2

