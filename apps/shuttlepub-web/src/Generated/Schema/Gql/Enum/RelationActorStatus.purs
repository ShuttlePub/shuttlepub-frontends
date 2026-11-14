module Generated.Schema.Gql.Enum.RelationActorStatus where

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

-- | Emumet ProfileRelationActorStatus: whether display information of a target is available.
data RelationActorStatus
  = RESOLVED
  | PENDING
  | UNAVAILABLE

instance eqRelationActorStatus :: Eq RelationActorStatus where
  eq = eq `on` show

instance ordRelationActorStatus :: Ord RelationActorStatus where
  compare = compare `on` show

instance gqlArgStringRelationActorStatus :: GqlArgString RelationActorStatus where
  toGqlArgStringImpl = show

instance decodeJsonRelationActorStatus :: DecodeJson RelationActorStatus where
  decodeJson = decodeJson >=> case _ of
    "RESOLVED" -> pure RESOLVED
    "PENDING" -> pure PENDING
    "UNAVAILABLE" -> pure UNAVAILABLE
    s -> Left $ TypeMismatch $ "Not a RelationActorStatus: " <> s

instance encodeJsonRelationActorStatus :: EncodeJson RelationActorStatus where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRelationActorStatus :: DecodeHasura RelationActorStatus where
  decodeHasura = decodeJson

instance encodeHasuraRelationActorStatus :: EncodeHasura RelationActorStatus where
  encodeHasura = encodeJson

instance showRelationActorStatus :: Show RelationActorStatus where
  show a = case a of
    RESOLVED -> "RESOLVED"
    PENDING -> "PENDING"
    UNAVAILABLE -> "UNAVAILABLE"

instance enumRelationActorStatus :: Enum RelationActorStatus where
  succ a = case a of
    RESOLVED -> Just PENDING
    PENDING -> Just UNAVAILABLE
    UNAVAILABLE -> Nothing
  pred a = case a of
    RESOLVED -> Nothing
    PENDING -> Just RESOLVED
    UNAVAILABLE -> Just PENDING

instance boundedRelationActorStatus :: Bounded RelationActorStatus where
  top = UNAVAILABLE
  bottom = RESOLVED

instance boundedEnumRelationActorStatus :: BoundedEnum RelationActorStatus where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just RESOLVED
    1 -> Just PENDING
    2 -> Just UNAVAILABLE
    _ -> Nothing
  fromEnum a = case a of
    RESOLVED -> 0
    PENDING -> 1
    UNAVAILABLE -> 2

