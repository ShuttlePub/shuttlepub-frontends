module Generated.Schema.Gql.Enum.DomainInputError where

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

-- | Why a typed domain was refused before anything was sent to Emumet.
data DomainInputError
  = EMPTY
  | WILDCARD
  | INVALID
  | IP_ADDRESS
  | OWN_SERVER

instance eqDomainInputError :: Eq DomainInputError where
  eq = eq `on` show

instance ordDomainInputError :: Ord DomainInputError where
  compare = compare `on` show

instance gqlArgStringDomainInputError :: GqlArgString DomainInputError where
  toGqlArgStringImpl = show

instance decodeJsonDomainInputError :: DecodeJson DomainInputError where
  decodeJson = decodeJson >=> case _ of
    "EMPTY" -> pure EMPTY
    "WILDCARD" -> pure WILDCARD
    "INVALID" -> pure INVALID
    "IP_ADDRESS" -> pure IP_ADDRESS
    "OWN_SERVER" -> pure OWN_SERVER
    s -> Left $ TypeMismatch $ "Not a DomainInputError: " <> s

instance encodeJsonDomainInputError :: EncodeJson DomainInputError where
  encodeJson = show >>> encodeJson

instance decdoeHasuraDomainInputError :: DecodeHasura DomainInputError where
  decodeHasura = decodeJson

instance encodeHasuraDomainInputError :: EncodeHasura DomainInputError where
  encodeHasura = encodeJson

instance showDomainInputError :: Show DomainInputError where
  show a = case a of
    EMPTY -> "EMPTY"
    WILDCARD -> "WILDCARD"
    INVALID -> "INVALID"
    IP_ADDRESS -> "IP_ADDRESS"
    OWN_SERVER -> "OWN_SERVER"

instance enumDomainInputError :: Enum DomainInputError where
  succ a = case a of
    EMPTY -> Just WILDCARD
    WILDCARD -> Just INVALID
    INVALID -> Just IP_ADDRESS
    IP_ADDRESS -> Just OWN_SERVER
    OWN_SERVER -> Nothing
  pred a = case a of
    EMPTY -> Nothing
    WILDCARD -> Just EMPTY
    INVALID -> Just WILDCARD
    IP_ADDRESS -> Just INVALID
    OWN_SERVER -> Just IP_ADDRESS

instance boundedDomainInputError :: Bounded DomainInputError where
  top = OWN_SERVER
  bottom = EMPTY

instance boundedEnumDomainInputError :: BoundedEnum DomainInputError where
  cardinality = Cardinality 5
  toEnum a = case a of
    0 -> Just EMPTY
    1 -> Just WILDCARD
    2 -> Just INVALID
    3 -> Just IP_ADDRESS
    4 -> Just OWN_SERVER
    _ -> Nothing
  fromEnum a = case a of
    EMPTY -> 0
    WILDCARD -> 1
    INVALID -> 2
    IP_ADDRESS -> 3
    OWN_SERVER -> 4

