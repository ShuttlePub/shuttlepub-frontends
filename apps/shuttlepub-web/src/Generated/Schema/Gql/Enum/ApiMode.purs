module Generated.Schema.Gql.Enum.ApiMode where

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

-- | Which data source the BFF was started with. Fixed at startup; never switches at runtime.
data ApiMode
  = MOCK
  | REAL

instance eqApiMode :: Eq ApiMode where
  eq = eq `on` show

instance ordApiMode :: Ord ApiMode where
  compare = compare `on` show

instance gqlArgStringApiMode :: GqlArgString ApiMode where
  toGqlArgStringImpl = show

instance decodeJsonApiMode :: DecodeJson ApiMode where
  decodeJson = decodeJson >=> case _ of
    "MOCK" -> pure MOCK
    "REAL" -> pure REAL
    s -> Left $ TypeMismatch $ "Not a ApiMode: " <> s

instance encodeJsonApiMode :: EncodeJson ApiMode where
  encodeJson = show >>> encodeJson

instance decdoeHasuraApiMode :: DecodeHasura ApiMode where
  decodeHasura = decodeJson

instance encodeHasuraApiMode :: EncodeHasura ApiMode where
  encodeHasura = encodeJson

instance showApiMode :: Show ApiMode where
  show a = case a of
    MOCK -> "MOCK"
    REAL -> "REAL"

instance enumApiMode :: Enum ApiMode where
  succ a = case a of
    MOCK -> Just REAL
    REAL -> Nothing
  pred a = case a of
    MOCK -> Nothing
    REAL -> Just MOCK

instance boundedApiMode :: Bounded ApiMode where
  top = REAL
  bottom = MOCK

instance boundedEnumApiMode :: BoundedEnum ApiMode where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just MOCK
    1 -> Just REAL
    _ -> Nothing
  fromEnum a = case a of
    MOCK -> 0
    REAL -> 1

