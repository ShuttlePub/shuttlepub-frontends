module Generated.Schema.Gql.Enum.RegistrationWebhookConfiguration where

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

-- | NOT_CONFIGURED (Webhook 無効。エラーではない) / MISCONFIGURED (設定不備。issue を参照) / CONFIGURED
data RegistrationWebhookConfiguration
  = NOT_CONFIGURED
  | MISCONFIGURED
  | CONFIGURED

instance eqRegistrationWebhookConfiguration :: Eq RegistrationWebhookConfiguration where
  eq = eq `on` show

instance ordRegistrationWebhookConfiguration :: Ord RegistrationWebhookConfiguration where
  compare = compare `on` show

instance gqlArgStringRegistrationWebhookConfiguration :: GqlArgString RegistrationWebhookConfiguration where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationWebhookConfiguration :: DecodeJson RegistrationWebhookConfiguration where
  decodeJson = decodeJson >=> case _ of
    "NOT_CONFIGURED" -> pure NOT_CONFIGURED
    "MISCONFIGURED" -> pure MISCONFIGURED
    "CONFIGURED" -> pure CONFIGURED
    s -> Left $ TypeMismatch $ "Not a RegistrationWebhookConfiguration: " <> s

instance encodeJsonRegistrationWebhookConfiguration :: EncodeJson RegistrationWebhookConfiguration where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationWebhookConfiguration :: DecodeHasura RegistrationWebhookConfiguration where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationWebhookConfiguration :: EncodeHasura RegistrationWebhookConfiguration where
  encodeHasura = encodeJson

instance showRegistrationWebhookConfiguration :: Show RegistrationWebhookConfiguration where
  show a = case a of
    NOT_CONFIGURED -> "NOT_CONFIGURED"
    MISCONFIGURED -> "MISCONFIGURED"
    CONFIGURED -> "CONFIGURED"

instance enumRegistrationWebhookConfiguration :: Enum RegistrationWebhookConfiguration where
  succ a = case a of
    NOT_CONFIGURED -> Just MISCONFIGURED
    MISCONFIGURED -> Just CONFIGURED
    CONFIGURED -> Nothing
  pred a = case a of
    NOT_CONFIGURED -> Nothing
    MISCONFIGURED -> Just NOT_CONFIGURED
    CONFIGURED -> Just MISCONFIGURED

instance boundedRegistrationWebhookConfiguration :: Bounded RegistrationWebhookConfiguration where
  top = CONFIGURED
  bottom = NOT_CONFIGURED

instance boundedEnumRegistrationWebhookConfiguration :: BoundedEnum RegistrationWebhookConfiguration where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just NOT_CONFIGURED
    1 -> Just MISCONFIGURED
    2 -> Just CONFIGURED
    _ -> Nothing
  fromEnum a = case a of
    NOT_CONFIGURED -> 0
    MISCONFIGURED -> 1
    CONFIGURED -> 2

