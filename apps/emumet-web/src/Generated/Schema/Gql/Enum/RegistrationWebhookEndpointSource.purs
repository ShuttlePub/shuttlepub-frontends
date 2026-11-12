module Generated.Schema.Gql.Enum.RegistrationWebhookEndpointSource where

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

-- | API 管理者が登録 / ENVIRONMENT_IMPORT 環境変数の 1 件を取り込んだ / ENVIRONMENT 環境変数のまま (編集・削除できない)
data RegistrationWebhookEndpointSource
  = API
  | ENVIRONMENT_IMPORT
  | ENVIRONMENT

instance eqRegistrationWebhookEndpointSource :: Eq RegistrationWebhookEndpointSource where
  eq = eq `on` show

instance ordRegistrationWebhookEndpointSource :: Ord RegistrationWebhookEndpointSource where
  compare = compare `on` show

instance gqlArgStringRegistrationWebhookEndpointSource :: GqlArgString RegistrationWebhookEndpointSource where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationWebhookEndpointSource :: DecodeJson RegistrationWebhookEndpointSource where
  decodeJson = decodeJson >=> case _ of
    "API" -> pure API
    "ENVIRONMENT_IMPORT" -> pure ENVIRONMENT_IMPORT
    "ENVIRONMENT" -> pure ENVIRONMENT
    s -> Left $ TypeMismatch $ "Not a RegistrationWebhookEndpointSource: " <> s

instance encodeJsonRegistrationWebhookEndpointSource :: EncodeJson RegistrationWebhookEndpointSource where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationWebhookEndpointSource :: DecodeHasura RegistrationWebhookEndpointSource where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationWebhookEndpointSource :: EncodeHasura RegistrationWebhookEndpointSource where
  encodeHasura = encodeJson

instance showRegistrationWebhookEndpointSource :: Show RegistrationWebhookEndpointSource where
  show a = case a of
    API -> "API"
    ENVIRONMENT_IMPORT -> "ENVIRONMENT_IMPORT"
    ENVIRONMENT -> "ENVIRONMENT"

instance enumRegistrationWebhookEndpointSource :: Enum RegistrationWebhookEndpointSource where
  succ a = case a of
    API -> Just ENVIRONMENT_IMPORT
    ENVIRONMENT_IMPORT -> Just ENVIRONMENT
    ENVIRONMENT -> Nothing
  pred a = case a of
    API -> Nothing
    ENVIRONMENT_IMPORT -> Just API
    ENVIRONMENT -> Just ENVIRONMENT_IMPORT

instance boundedRegistrationWebhookEndpointSource :: Bounded RegistrationWebhookEndpointSource where
  top = ENVIRONMENT
  bottom = API

instance boundedEnumRegistrationWebhookEndpointSource :: BoundedEnum RegistrationWebhookEndpointSource where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just API
    1 -> Just ENVIRONMENT_IMPORT
    2 -> Just ENVIRONMENT
    _ -> Nothing
  fromEnum a = case a of
    API -> 0
    ENVIRONMENT_IMPORT -> 1
    ENVIRONMENT -> 2

