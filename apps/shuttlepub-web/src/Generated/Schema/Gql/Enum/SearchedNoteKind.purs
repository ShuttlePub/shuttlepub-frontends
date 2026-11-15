module Generated.Schema.Gql.Enum.SearchedNoteKind where

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

-- | Kind of a searched Note (a pure repost is never searchable).
data SearchedNoteKind
  = POST
  | REPLY
  | QUOTE

instance eqSearchedNoteKind :: Eq SearchedNoteKind where
  eq = eq `on` show

instance ordSearchedNoteKind :: Ord SearchedNoteKind where
  compare = compare `on` show

instance gqlArgStringSearchedNoteKind :: GqlArgString SearchedNoteKind where
  toGqlArgStringImpl = show

instance decodeJsonSearchedNoteKind :: DecodeJson SearchedNoteKind where
  decodeJson = decodeJson >=> case _ of
    "POST" -> pure POST
    "REPLY" -> pure REPLY
    "QUOTE" -> pure QUOTE
    s -> Left $ TypeMismatch $ "Not a SearchedNoteKind: " <> s

instance encodeJsonSearchedNoteKind :: EncodeJson SearchedNoteKind where
  encodeJson = show >>> encodeJson

instance decdoeHasuraSearchedNoteKind :: DecodeHasura SearchedNoteKind where
  decodeHasura = decodeJson

instance encodeHasuraSearchedNoteKind :: EncodeHasura SearchedNoteKind where
  encodeHasura = encodeJson

instance showSearchedNoteKind :: Show SearchedNoteKind where
  show a = case a of
    POST -> "POST"
    REPLY -> "REPLY"
    QUOTE -> "QUOTE"

instance enumSearchedNoteKind :: Enum SearchedNoteKind where
  succ a = case a of
    POST -> Just REPLY
    REPLY -> Just QUOTE
    QUOTE -> Nothing
  pred a = case a of
    POST -> Nothing
    REPLY -> Just POST
    QUOTE -> Just REPLY

instance boundedSearchedNoteKind :: Bounded SearchedNoteKind where
  top = QUOTE
  bottom = POST

instance boundedEnumSearchedNoteKind :: BoundedEnum SearchedNoteKind where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just POST
    1 -> Just REPLY
    2 -> Just QUOTE
    _ -> Nothing
  fromEnum a = case a of
    POST -> 0
    REPLY -> 1
    QUOTE -> 2

