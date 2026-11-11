module Generated.Schema.Gql.Enum.InstanceRole where

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

data InstanceRole
  = ADMIN
  | MODERATOR

instance eqInstanceRole :: Eq InstanceRole where
  eq = eq `on` show

instance ordInstanceRole :: Ord InstanceRole where
  compare = compare `on` show

instance gqlArgStringInstanceRole :: GqlArgString InstanceRole where
  toGqlArgStringImpl = show

instance decodeJsonInstanceRole :: DecodeJson InstanceRole where
  decodeJson = decodeJson >=> case _ of
    "ADMIN" -> pure ADMIN
    "MODERATOR" -> pure MODERATOR
    s -> Left $ TypeMismatch $ "Not a InstanceRole: " <> s

instance encodeJsonInstanceRole :: EncodeJson InstanceRole where
  encodeJson = show >>> encodeJson

instance decdoeHasuraInstanceRole :: DecodeHasura InstanceRole where
  decodeHasura = decodeJson

instance encodeHasuraInstanceRole :: EncodeHasura InstanceRole where
  encodeHasura = encodeJson

instance showInstanceRole :: Show InstanceRole where
  show a = case a of
    ADMIN -> "ADMIN"
    MODERATOR -> "MODERATOR"

instance enumInstanceRole :: Enum InstanceRole where
  succ a = case a of
    ADMIN -> Just MODERATOR
    MODERATOR -> Nothing
  pred a = case a of
    ADMIN -> Nothing
    MODERATOR -> Just ADMIN

instance boundedInstanceRole :: Bounded InstanceRole where
  top = MODERATOR
  bottom = ADMIN

instance boundedEnumInstanceRole :: BoundedEnum InstanceRole where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just ADMIN
    1 -> Just MODERATOR
    _ -> Nothing
  fromEnum a = case a of
    ADMIN -> 0
    MODERATOR -> 1

