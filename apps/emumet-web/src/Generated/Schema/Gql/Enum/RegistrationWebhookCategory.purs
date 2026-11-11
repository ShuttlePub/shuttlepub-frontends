module Generated.Schema.Gql.Enum.RegistrationWebhookCategory where

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

-- | 送る通知のカテゴリ。OUTAGE 障害 / RECOVERY 復旧 / AUTO_STOP 自動停止 / OVERRIDE 強制開放
data RegistrationWebhookCategory
  = OUTAGE
  | RECOVERY
  | AUTO_STOP
  | OVERRIDE

instance eqRegistrationWebhookCategory :: Eq RegistrationWebhookCategory where
  eq = eq `on` show

instance ordRegistrationWebhookCategory :: Ord RegistrationWebhookCategory where
  compare = compare `on` show

instance gqlArgStringRegistrationWebhookCategory :: GqlArgString RegistrationWebhookCategory where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationWebhookCategory :: DecodeJson RegistrationWebhookCategory where
  decodeJson = decodeJson >=> case _ of
    "OUTAGE" -> pure OUTAGE
    "RECOVERY" -> pure RECOVERY
    "AUTO_STOP" -> pure AUTO_STOP
    "OVERRIDE" -> pure OVERRIDE
    s -> Left $ TypeMismatch $ "Not a RegistrationWebhookCategory: " <> s

instance encodeJsonRegistrationWebhookCategory :: EncodeJson RegistrationWebhookCategory where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationWebhookCategory :: DecodeHasura RegistrationWebhookCategory where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationWebhookCategory :: EncodeHasura RegistrationWebhookCategory where
  encodeHasura = encodeJson

instance showRegistrationWebhookCategory :: Show RegistrationWebhookCategory where
  show a = case a of
    OUTAGE -> "OUTAGE"
    RECOVERY -> "RECOVERY"
    AUTO_STOP -> "AUTO_STOP"
    OVERRIDE -> "OVERRIDE"

instance enumRegistrationWebhookCategory :: Enum RegistrationWebhookCategory where
  succ a = case a of
    OUTAGE -> Just RECOVERY
    RECOVERY -> Just AUTO_STOP
    AUTO_STOP -> Just OVERRIDE
    OVERRIDE -> Nothing
  pred a = case a of
    OUTAGE -> Nothing
    RECOVERY -> Just OUTAGE
    AUTO_STOP -> Just RECOVERY
    OVERRIDE -> Just AUTO_STOP

instance boundedRegistrationWebhookCategory :: Bounded RegistrationWebhookCategory where
  top = OVERRIDE
  bottom = OUTAGE

instance boundedEnumRegistrationWebhookCategory :: BoundedEnum RegistrationWebhookCategory where
  cardinality = Cardinality 4
  toEnum a = case a of
    0 -> Just OUTAGE
    1 -> Just RECOVERY
    2 -> Just AUTO_STOP
    3 -> Just OVERRIDE
    _ -> Nothing
  fromEnum a = case a of
    OUTAGE -> 0
    RECOVERY -> 1
    AUTO_STOP -> 2
    OVERRIDE -> 3

