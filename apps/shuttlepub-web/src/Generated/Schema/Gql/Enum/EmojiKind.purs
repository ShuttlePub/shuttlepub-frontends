module Generated.Schema.Gql.Enum.EmojiKind where

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

-- | EmojiRef.type.
data EmojiKind
  = UNICODE
  | CUSTOM

instance eqEmojiKind :: Eq EmojiKind where
  eq = eq `on` show

instance ordEmojiKind :: Ord EmojiKind where
  compare = compare `on` show

instance gqlArgStringEmojiKind :: GqlArgString EmojiKind where
  toGqlArgStringImpl = show

instance decodeJsonEmojiKind :: DecodeJson EmojiKind where
  decodeJson = decodeJson >=> case _ of
    "UNICODE" -> pure UNICODE
    "CUSTOM" -> pure CUSTOM
    s -> Left $ TypeMismatch $ "Not a EmojiKind: " <> s

instance encodeJsonEmojiKind :: EncodeJson EmojiKind where
  encodeJson = show >>> encodeJson

instance decdoeHasuraEmojiKind :: DecodeHasura EmojiKind where
  decodeHasura = decodeJson

instance encodeHasuraEmojiKind :: EncodeHasura EmojiKind where
  encodeHasura = encodeJson

instance showEmojiKind :: Show EmojiKind where
  show a = case a of
    UNICODE -> "UNICODE"
    CUSTOM -> "CUSTOM"

instance enumEmojiKind :: Enum EmojiKind where
  succ a = case a of
    UNICODE -> Just CUSTOM
    CUSTOM -> Nothing
  pred a = case a of
    UNICODE -> Nothing
    CUSTOM -> Just UNICODE

instance boundedEmojiKind :: Bounded EmojiKind where
  top = CUSTOM
  bottom = UNICODE

instance boundedEnumEmojiKind :: BoundedEnum EmojiKind where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just UNICODE
    1 -> Just CUSTOM
    _ -> Nothing
  fromEnum a = case a of
    UNICODE -> 0
    CUSTOM -> 1

