module Generated.Schema.Gql.Enum.RegistrationGateEventKind where

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

data RegistrationGateEventKind
  = OUTAGE_STARTED
  | OUTAGE_RECOVERED
  | PROTECTION_DEGRADED
  | PROTECTION_LOST_STOPPED
  | OVERRIDE_STARTED
  | OVERRIDE_REVOKED

instance eqRegistrationGateEventKind :: Eq RegistrationGateEventKind where
  eq = eq `on` show

instance ordRegistrationGateEventKind :: Ord RegistrationGateEventKind where
  compare = compare `on` show

instance gqlArgStringRegistrationGateEventKind :: GqlArgString RegistrationGateEventKind where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationGateEventKind :: DecodeJson RegistrationGateEventKind where
  decodeJson = decodeJson >=> case _ of
    "OUTAGE_STARTED" -> pure OUTAGE_STARTED
    "OUTAGE_RECOVERED" -> pure OUTAGE_RECOVERED
    "PROTECTION_DEGRADED" -> pure PROTECTION_DEGRADED
    "PROTECTION_LOST_STOPPED" -> pure PROTECTION_LOST_STOPPED
    "OVERRIDE_STARTED" -> pure OVERRIDE_STARTED
    "OVERRIDE_REVOKED" -> pure OVERRIDE_REVOKED
    s -> Left $ TypeMismatch $ "Not a RegistrationGateEventKind: " <> s

instance encodeJsonRegistrationGateEventKind :: EncodeJson RegistrationGateEventKind where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationGateEventKind :: DecodeHasura RegistrationGateEventKind where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationGateEventKind :: EncodeHasura RegistrationGateEventKind where
  encodeHasura = encodeJson

instance showRegistrationGateEventKind :: Show RegistrationGateEventKind where
  show a = case a of
    OUTAGE_STARTED -> "OUTAGE_STARTED"
    OUTAGE_RECOVERED -> "OUTAGE_RECOVERED"
    PROTECTION_DEGRADED -> "PROTECTION_DEGRADED"
    PROTECTION_LOST_STOPPED -> "PROTECTION_LOST_STOPPED"
    OVERRIDE_STARTED -> "OVERRIDE_STARTED"
    OVERRIDE_REVOKED -> "OVERRIDE_REVOKED"

instance enumRegistrationGateEventKind :: Enum RegistrationGateEventKind where
  succ a = case a of
    OUTAGE_STARTED -> Just OUTAGE_RECOVERED
    OUTAGE_RECOVERED -> Just PROTECTION_DEGRADED
    PROTECTION_DEGRADED -> Just PROTECTION_LOST_STOPPED
    PROTECTION_LOST_STOPPED -> Just OVERRIDE_STARTED
    OVERRIDE_STARTED -> Just OVERRIDE_REVOKED
    OVERRIDE_REVOKED -> Nothing
  pred a = case a of
    OUTAGE_STARTED -> Nothing
    OUTAGE_RECOVERED -> Just OUTAGE_STARTED
    PROTECTION_DEGRADED -> Just OUTAGE_RECOVERED
    PROTECTION_LOST_STOPPED -> Just PROTECTION_DEGRADED
    OVERRIDE_STARTED -> Just PROTECTION_LOST_STOPPED
    OVERRIDE_REVOKED -> Just OVERRIDE_STARTED

instance boundedRegistrationGateEventKind :: Bounded RegistrationGateEventKind where
  top = OVERRIDE_REVOKED
  bottom = OUTAGE_STARTED

instance boundedEnumRegistrationGateEventKind :: BoundedEnum RegistrationGateEventKind where
  cardinality = Cardinality 6
  toEnum a = case a of
    0 -> Just OUTAGE_STARTED
    1 -> Just OUTAGE_RECOVERED
    2 -> Just PROTECTION_DEGRADED
    3 -> Just PROTECTION_LOST_STOPPED
    4 -> Just OVERRIDE_STARTED
    5 -> Just OVERRIDE_REVOKED
    _ -> Nothing
  fromEnum a = case a of
    OUTAGE_STARTED -> 0
    OUTAGE_RECOVERED -> 1
    PROTECTION_DEGRADED -> 2
    PROTECTION_LOST_STOPPED -> 3
    OVERRIDE_STARTED -> 4
    OVERRIDE_REVOKED -> 5

