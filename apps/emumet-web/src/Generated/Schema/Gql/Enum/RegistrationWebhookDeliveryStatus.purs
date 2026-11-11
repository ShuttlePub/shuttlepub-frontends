module Generated.Schema.Gql.Enum.RegistrationWebhookDeliveryStatus where

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

data RegistrationWebhookDeliveryStatus
  = PENDING
  | IN_FLIGHT
  | RETRYING
  | DELIVERED
  | FAILED

instance eqRegistrationWebhookDeliveryStatus :: Eq RegistrationWebhookDeliveryStatus where
  eq = eq `on` show

instance ordRegistrationWebhookDeliveryStatus :: Ord RegistrationWebhookDeliveryStatus where
  compare = compare `on` show

instance gqlArgStringRegistrationWebhookDeliveryStatus :: GqlArgString RegistrationWebhookDeliveryStatus where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationWebhookDeliveryStatus :: DecodeJson RegistrationWebhookDeliveryStatus where
  decodeJson = decodeJson >=> case _ of
    "PENDING" -> pure PENDING
    "IN_FLIGHT" -> pure IN_FLIGHT
    "RETRYING" -> pure RETRYING
    "DELIVERED" -> pure DELIVERED
    "FAILED" -> pure FAILED
    s -> Left $ TypeMismatch $ "Not a RegistrationWebhookDeliveryStatus: " <> s

instance encodeJsonRegistrationWebhookDeliveryStatus :: EncodeJson RegistrationWebhookDeliveryStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationWebhookDeliveryStatus :: DecodeHasura RegistrationWebhookDeliveryStatus where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationWebhookDeliveryStatus :: EncodeHasura RegistrationWebhookDeliveryStatus where
  encodeHasura = encodeJson

instance showRegistrationWebhookDeliveryStatus :: Show RegistrationWebhookDeliveryStatus where
  show a = case a of
    PENDING -> "PENDING"
    IN_FLIGHT -> "IN_FLIGHT"
    RETRYING -> "RETRYING"
    DELIVERED -> "DELIVERED"
    FAILED -> "FAILED"

instance enumRegistrationWebhookDeliveryStatus :: Enum RegistrationWebhookDeliveryStatus where
  succ a = case a of
    PENDING -> Just IN_FLIGHT
    IN_FLIGHT -> Just RETRYING
    RETRYING -> Just DELIVERED
    DELIVERED -> Just FAILED
    FAILED -> Nothing
  pred a = case a of
    PENDING -> Nothing
    IN_FLIGHT -> Just PENDING
    RETRYING -> Just IN_FLIGHT
    DELIVERED -> Just RETRYING
    FAILED -> Just DELIVERED

instance boundedRegistrationWebhookDeliveryStatus :: Bounded RegistrationWebhookDeliveryStatus where
  top = FAILED
  bottom = PENDING

instance boundedEnumRegistrationWebhookDeliveryStatus :: BoundedEnum RegistrationWebhookDeliveryStatus where
  cardinality = Cardinality 5
  toEnum a = case a of
    0 -> Just PENDING
    1 -> Just IN_FLIGHT
    2 -> Just RETRYING
    3 -> Just DELIVERED
    4 -> Just FAILED
    _ -> Nothing
  fromEnum a = case a of
    PENDING -> 0
    IN_FLIGHT -> 1
    RETRYING -> 2
    DELIVERED -> 3
    FAILED -> 4

