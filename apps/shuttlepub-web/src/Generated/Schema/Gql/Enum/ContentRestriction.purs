module Generated.Schema.Gql.Enum.ContentRestriction where

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

-- | S8 ContentRestriction: an independent gate. A reveal never clears it and none of the gated content is sent.
data ContentRestriction
  = CW
  | SENSITIVE
  | DELETED
  | VISIBILITY

instance eqContentRestriction :: Eq ContentRestriction where
  eq = eq `on` show

instance ordContentRestriction :: Ord ContentRestriction where
  compare = compare `on` show

instance gqlArgStringContentRestriction :: GqlArgString ContentRestriction where
  toGqlArgStringImpl = show

instance decodeJsonContentRestriction :: DecodeJson ContentRestriction where
  decodeJson = decodeJson >=> case _ of
    "CW" -> pure CW
    "SENSITIVE" -> pure SENSITIVE
    "DELETED" -> pure DELETED
    "VISIBILITY" -> pure VISIBILITY
    s -> Left $ TypeMismatch $ "Not a ContentRestriction: " <> s

instance encodeJsonContentRestriction :: EncodeJson ContentRestriction where
  encodeJson = show >>> encodeJson

instance decdoeHasuraContentRestriction :: DecodeHasura ContentRestriction where
  decodeHasura = decodeJson

instance encodeHasuraContentRestriction :: EncodeHasura ContentRestriction where
  encodeHasura = encodeJson

instance showContentRestriction :: Show ContentRestriction where
  show a = case a of
    CW -> "CW"
    SENSITIVE -> "SENSITIVE"
    DELETED -> "DELETED"
    VISIBILITY -> "VISIBILITY"

instance enumContentRestriction :: Enum ContentRestriction where
  succ a = case a of
    CW -> Just SENSITIVE
    SENSITIVE -> Just DELETED
    DELETED -> Just VISIBILITY
    VISIBILITY -> Nothing
  pred a = case a of
    CW -> Nothing
    SENSITIVE -> Just CW
    DELETED -> Just SENSITIVE
    VISIBILITY -> Just DELETED

instance boundedContentRestriction :: Bounded ContentRestriction where
  top = VISIBILITY
  bottom = CW

instance boundedEnumContentRestriction :: BoundedEnum ContentRestriction where
  cardinality = Cardinality 4
  toEnum a = case a of
    0 -> Just CW
    1 -> Just SENSITIVE
    2 -> Just DELETED
    3 -> Just VISIBILITY
    _ -> Nothing
  fromEnum a = case a of
    CW -> 0
    SENSITIVE -> 1
    DELETED -> 2
    VISIBILITY -> 3

