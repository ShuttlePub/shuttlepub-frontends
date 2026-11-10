module Generated.Schema.Gql.Enum.RegistrationDecision where

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

-- | 判定。ACCEPTING 受付中 / TEMPORARY_REJECT 一時拒否 (復旧で自動再開) / STOPPED 設定喪失で停止 (手動再開が必要) / ADMIN_CLOSED 管理者閉鎖
data RegistrationDecision
  = ACCEPTING
  | ADMIN_CLOSED
  | STOPPED
  | TEMPORARY_REJECT

instance eqRegistrationDecision :: Eq RegistrationDecision where
  eq = eq `on` show

instance ordRegistrationDecision :: Ord RegistrationDecision where
  compare = compare `on` show

instance gqlArgStringRegistrationDecision :: GqlArgString RegistrationDecision where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationDecision :: DecodeJson RegistrationDecision where
  decodeJson = decodeJson >=> case _ of
    "ACCEPTING" -> pure ACCEPTING
    "ADMIN_CLOSED" -> pure ADMIN_CLOSED
    "STOPPED" -> pure STOPPED
    "TEMPORARY_REJECT" -> pure TEMPORARY_REJECT
    s -> Left $ TypeMismatch $ "Not a RegistrationDecision: " <> s

instance encodeJsonRegistrationDecision :: EncodeJson RegistrationDecision where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationDecision :: DecodeHasura RegistrationDecision where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationDecision :: EncodeHasura RegistrationDecision where
  encodeHasura = encodeJson

instance showRegistrationDecision :: Show RegistrationDecision where
  show a = case a of
    ACCEPTING -> "ACCEPTING"
    ADMIN_CLOSED -> "ADMIN_CLOSED"
    STOPPED -> "STOPPED"
    TEMPORARY_REJECT -> "TEMPORARY_REJECT"

instance enumRegistrationDecision :: Enum RegistrationDecision where
  succ a = case a of
    ACCEPTING -> Just ADMIN_CLOSED
    ADMIN_CLOSED -> Just STOPPED
    STOPPED -> Just TEMPORARY_REJECT
    TEMPORARY_REJECT -> Nothing
  pred a = case a of
    ACCEPTING -> Nothing
    ADMIN_CLOSED -> Just ACCEPTING
    STOPPED -> Just ADMIN_CLOSED
    TEMPORARY_REJECT -> Just STOPPED

instance boundedRegistrationDecision :: Bounded RegistrationDecision where
  top = TEMPORARY_REJECT
  bottom = ACCEPTING

instance boundedEnumRegistrationDecision :: BoundedEnum RegistrationDecision where
  cardinality = Cardinality 4
  toEnum a = case a of
    0 -> Just ACCEPTING
    1 -> Just ADMIN_CLOSED
    2 -> Just STOPPED
    3 -> Just TEMPORARY_REJECT
    _ -> Nothing
  fromEnum a = case a of
    ACCEPTING -> 0
    ADMIN_CLOSED -> 1
    STOPPED -> 2
    TEMPORARY_REJECT -> 3

