module Generated.Schema.Gql.Enum.RegistrationWebhookEndpointStatus where

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

-- | 状態チップ。HEALTHY 正常 / FAILING 配送失敗 (未解決の failed 配送、または復号不可・設定不備)
data RegistrationWebhookEndpointStatus
  = HEALTHY
  | FAILING

instance eqRegistrationWebhookEndpointStatus :: Eq RegistrationWebhookEndpointStatus where
  eq = eq `on` show

instance ordRegistrationWebhookEndpointStatus :: Ord RegistrationWebhookEndpointStatus where
  compare = compare `on` show

instance gqlArgStringRegistrationWebhookEndpointStatus :: GqlArgString RegistrationWebhookEndpointStatus where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationWebhookEndpointStatus :: DecodeJson RegistrationWebhookEndpointStatus where
  decodeJson = decodeJson >=> case _ of
    "HEALTHY" -> pure HEALTHY
    "FAILING" -> pure FAILING
    s -> Left $ TypeMismatch $ "Not a RegistrationWebhookEndpointStatus: " <> s

instance encodeJsonRegistrationWebhookEndpointStatus :: EncodeJson RegistrationWebhookEndpointStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationWebhookEndpointStatus :: DecodeHasura RegistrationWebhookEndpointStatus where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationWebhookEndpointStatus :: EncodeHasura RegistrationWebhookEndpointStatus where
  encodeHasura = encodeJson

instance showRegistrationWebhookEndpointStatus :: Show RegistrationWebhookEndpointStatus where
  show a = case a of
    HEALTHY -> "HEALTHY"
    FAILING -> "FAILING"

instance enumRegistrationWebhookEndpointStatus :: Enum RegistrationWebhookEndpointStatus where
  succ a = case a of
    HEALTHY -> Just FAILING
    FAILING -> Nothing
  pred a = case a of
    HEALTHY -> Nothing
    FAILING -> Just HEALTHY

instance boundedRegistrationWebhookEndpointStatus :: Bounded RegistrationWebhookEndpointStatus where
  top = FAILING
  bottom = HEALTHY

instance boundedEnumRegistrationWebhookEndpointStatus :: BoundedEnum RegistrationWebhookEndpointStatus where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just HEALTHY
    1 -> Just FAILING
    _ -> Nothing
  fromEnum a = case a of
    HEALTHY -> 0
    FAILING -> 1

