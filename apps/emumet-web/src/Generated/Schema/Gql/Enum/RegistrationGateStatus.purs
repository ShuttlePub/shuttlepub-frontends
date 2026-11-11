module Generated.Schema.Gql.Enum.RegistrationGateStatus where

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

-- | 管理画面の状態 (ui-spec A-2)。decision を優先して決める:
-- | STOPPED → AUTO_STOPPED / ADMIN_CLOSED → (revision 0 なら NOT_OPENED、それ以外 ADMIN_STOPPED) /
-- | override 有効 → OVERRIDE / TEMPORARY_REJECT → TEMPORARILY_SUSPENDED / ACCEPTING → OPEN
data RegistrationGateStatus
  = NOT_OPENED
  | OPEN
  | TEMPORARILY_SUSPENDED
  | AUTO_STOPPED
  | ADMIN_STOPPED
  | OVERRIDE

instance eqRegistrationGateStatus :: Eq RegistrationGateStatus where
  eq = eq `on` show

instance ordRegistrationGateStatus :: Ord RegistrationGateStatus where
  compare = compare `on` show

instance gqlArgStringRegistrationGateStatus :: GqlArgString RegistrationGateStatus where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationGateStatus :: DecodeJson RegistrationGateStatus where
  decodeJson = decodeJson >=> case _ of
    "NOT_OPENED" -> pure NOT_OPENED
    "OPEN" -> pure OPEN
    "TEMPORARILY_SUSPENDED" -> pure TEMPORARILY_SUSPENDED
    "AUTO_STOPPED" -> pure AUTO_STOPPED
    "ADMIN_STOPPED" -> pure ADMIN_STOPPED
    "OVERRIDE" -> pure OVERRIDE
    s -> Left $ TypeMismatch $ "Not a RegistrationGateStatus: " <> s

instance encodeJsonRegistrationGateStatus :: EncodeJson RegistrationGateStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationGateStatus :: DecodeHasura RegistrationGateStatus where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationGateStatus :: EncodeHasura RegistrationGateStatus where
  encodeHasura = encodeJson

instance showRegistrationGateStatus :: Show RegistrationGateStatus where
  show a = case a of
    NOT_OPENED -> "NOT_OPENED"
    OPEN -> "OPEN"
    TEMPORARILY_SUSPENDED -> "TEMPORARILY_SUSPENDED"
    AUTO_STOPPED -> "AUTO_STOPPED"
    ADMIN_STOPPED -> "ADMIN_STOPPED"
    OVERRIDE -> "OVERRIDE"

instance enumRegistrationGateStatus :: Enum RegistrationGateStatus where
  succ a = case a of
    NOT_OPENED -> Just OPEN
    OPEN -> Just TEMPORARILY_SUSPENDED
    TEMPORARILY_SUSPENDED -> Just AUTO_STOPPED
    AUTO_STOPPED -> Just ADMIN_STOPPED
    ADMIN_STOPPED -> Just OVERRIDE
    OVERRIDE -> Nothing
  pred a = case a of
    NOT_OPENED -> Nothing
    OPEN -> Just NOT_OPENED
    TEMPORARILY_SUSPENDED -> Just OPEN
    AUTO_STOPPED -> Just TEMPORARILY_SUSPENDED
    ADMIN_STOPPED -> Just AUTO_STOPPED
    OVERRIDE -> Just ADMIN_STOPPED

instance boundedRegistrationGateStatus :: Bounded RegistrationGateStatus where
  top = OVERRIDE
  bottom = NOT_OPENED

instance boundedEnumRegistrationGateStatus :: BoundedEnum RegistrationGateStatus where
  cardinality = Cardinality 6
  toEnum a = case a of
    0 -> Just NOT_OPENED
    1 -> Just OPEN
    2 -> Just TEMPORARILY_SUSPENDED
    3 -> Just AUTO_STOPPED
    4 -> Just ADMIN_STOPPED
    5 -> Just OVERRIDE
    _ -> Nothing
  fromEnum a = case a of
    NOT_OPENED -> 0
    OPEN -> 1
    TEMPORARILY_SUSPENDED -> 2
    AUTO_STOPPED -> 3
    ADMIN_STOPPED -> 4
    OVERRIDE -> 5

