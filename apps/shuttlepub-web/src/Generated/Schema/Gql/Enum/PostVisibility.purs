module Generated.Schema.Gql.Enum.PostVisibility where

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

-- | PROVISIONAL placeholder mirroring Misskey. ShuttlePub's visibility model is undecided.
data PostVisibility
  = PUBLIC
  | HOME
  | FOLLOWERS
  | DIRECT

instance eqPostVisibility :: Eq PostVisibility where
  eq = eq `on` show

instance ordPostVisibility :: Ord PostVisibility where
  compare = compare `on` show

instance gqlArgStringPostVisibility :: GqlArgString PostVisibility where
  toGqlArgStringImpl = show

instance decodeJsonPostVisibility :: DecodeJson PostVisibility where
  decodeJson = decodeJson >=> case _ of
    "PUBLIC" -> pure PUBLIC
    "HOME" -> pure HOME
    "FOLLOWERS" -> pure FOLLOWERS
    "DIRECT" -> pure DIRECT
    s -> Left $ TypeMismatch $ "Not a PostVisibility: " <> s

instance encodeJsonPostVisibility :: EncodeJson PostVisibility where
  encodeJson = show >>> encodeJson

instance decdoeHasuraPostVisibility :: DecodeHasura PostVisibility where
  decodeHasura = decodeJson

instance encodeHasuraPostVisibility :: EncodeHasura PostVisibility where
  encodeHasura = encodeJson

instance showPostVisibility :: Show PostVisibility where
  show a = case a of
    PUBLIC -> "PUBLIC"
    HOME -> "HOME"
    FOLLOWERS -> "FOLLOWERS"
    DIRECT -> "DIRECT"

instance enumPostVisibility :: Enum PostVisibility where
  succ a = case a of
    PUBLIC -> Just HOME
    HOME -> Just FOLLOWERS
    FOLLOWERS -> Just DIRECT
    DIRECT -> Nothing
  pred a = case a of
    PUBLIC -> Nothing
    HOME -> Just PUBLIC
    FOLLOWERS -> Just HOME
    DIRECT -> Just FOLLOWERS

instance boundedPostVisibility :: Bounded PostVisibility where
  top = DIRECT
  bottom = PUBLIC

instance boundedEnumPostVisibility :: BoundedEnum PostVisibility where
  cardinality = Cardinality 4
  toEnum a = case a of
    0 -> Just PUBLIC
    1 -> Just HOME
    2 -> Just FOLLOWERS
    3 -> Just DIRECT
    _ -> Nothing
  fromEnum a = case a of
    PUBLIC -> 0
    HOME -> 1
    FOLLOWERS -> 2
    DIRECT -> 3

