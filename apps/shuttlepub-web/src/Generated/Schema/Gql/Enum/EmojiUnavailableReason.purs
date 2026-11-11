module Generated.Schema.Gql.Enum.EmojiUnavailableReason where

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

-- | EmojiUnavailableReason.
data EmojiUnavailableReason
  = DELETED
  | DISABLED

instance eqEmojiUnavailableReason :: Eq EmojiUnavailableReason where
  eq = eq `on` show

instance ordEmojiUnavailableReason :: Ord EmojiUnavailableReason where
  compare = compare `on` show

instance gqlArgStringEmojiUnavailableReason :: GqlArgString EmojiUnavailableReason where
  toGqlArgStringImpl = show

instance decodeJsonEmojiUnavailableReason :: DecodeJson EmojiUnavailableReason where
  decodeJson = decodeJson >=> case _ of
    "DELETED" -> pure DELETED
    "DISABLED" -> pure DISABLED
    s -> Left $ TypeMismatch $ "Not a EmojiUnavailableReason: " <> s

instance encodeJsonEmojiUnavailableReason :: EncodeJson EmojiUnavailableReason where
  encodeJson = show >>> encodeJson

instance decdoeHasuraEmojiUnavailableReason :: DecodeHasura EmojiUnavailableReason where
  decodeHasura = decodeJson

instance encodeHasuraEmojiUnavailableReason :: EncodeHasura EmojiUnavailableReason where
  encodeHasura = encodeJson

instance showEmojiUnavailableReason :: Show EmojiUnavailableReason where
  show a = case a of
    DELETED -> "DELETED"
    DISABLED -> "DISABLED"

instance enumEmojiUnavailableReason :: Enum EmojiUnavailableReason where
  succ a = case a of
    DELETED -> Just DISABLED
    DISABLED -> Nothing
  pred a = case a of
    DELETED -> Nothing
    DISABLED -> Just DELETED

instance boundedEmojiUnavailableReason :: Bounded EmojiUnavailableReason where
  top = DISABLED
  bottom = DELETED

instance boundedEnumEmojiUnavailableReason :: BoundedEnum EmojiUnavailableReason where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just DELETED
    1 -> Just DISABLED
    _ -> Nothing
  fromEnum a = case a of
    DELETED -> 0
    DISABLED -> 1

