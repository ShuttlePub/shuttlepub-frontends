module Generated.Schema.Gql.Enum.RelationActorKind where

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

-- | Emumet ProfileRelationActorKind: whether a target lives on this server or a remote one.
data RelationActorKind
  = LOCAL
  | REMOTE

instance eqRelationActorKind :: Eq RelationActorKind where
  eq = eq `on` show

instance ordRelationActorKind :: Ord RelationActorKind where
  compare = compare `on` show

instance gqlArgStringRelationActorKind :: GqlArgString RelationActorKind where
  toGqlArgStringImpl = show

instance decodeJsonRelationActorKind :: DecodeJson RelationActorKind where
  decodeJson = decodeJson >=> case _ of
    "LOCAL" -> pure LOCAL
    "REMOTE" -> pure REMOTE
    s -> Left $ TypeMismatch $ "Not a RelationActorKind: " <> s

instance encodeJsonRelationActorKind :: EncodeJson RelationActorKind where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRelationActorKind :: DecodeHasura RelationActorKind where
  decodeHasura = decodeJson

instance encodeHasuraRelationActorKind :: EncodeHasura RelationActorKind where
  encodeHasura = encodeJson

instance showRelationActorKind :: Show RelationActorKind where
  show a = case a of
    LOCAL -> "LOCAL"
    REMOTE -> "REMOTE"

instance enumRelationActorKind :: Enum RelationActorKind where
  succ a = case a of
    LOCAL -> Just REMOTE
    REMOTE -> Nothing
  pred a = case a of
    LOCAL -> Nothing
    REMOTE -> Just LOCAL

instance boundedRelationActorKind :: Bounded RelationActorKind where
  top = REMOTE
  bottom = LOCAL

instance boundedEnumRelationActorKind :: BoundedEnum RelationActorKind where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just LOCAL
    1 -> Just REMOTE
    _ -> Nothing
  fromEnum a = case a of
    LOCAL -> 0
    REMOTE -> 1

