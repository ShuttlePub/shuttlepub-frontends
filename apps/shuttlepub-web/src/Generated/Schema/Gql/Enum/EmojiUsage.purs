module Generated.Schema.Gql.Enum.EmojiUsage where

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

-- | EmojiUsage: where a custom emoji may be used. EXISTING_REACTION_ONLY is an external emoji.
data EmojiUsage
  = EXISTING_REACTION_ONLY
  | ANYWHERE

instance eqEmojiUsage :: Eq EmojiUsage where
  eq = eq `on` show

instance ordEmojiUsage :: Ord EmojiUsage where
  compare = compare `on` show

instance gqlArgStringEmojiUsage :: GqlArgString EmojiUsage where
  toGqlArgStringImpl = show

instance decodeJsonEmojiUsage :: DecodeJson EmojiUsage where
  decodeJson = decodeJson >=> case _ of
    "EXISTING_REACTION_ONLY" -> pure EXISTING_REACTION_ONLY
    "ANYWHERE" -> pure ANYWHERE
    s -> Left $ TypeMismatch $ "Not a EmojiUsage: " <> s

instance encodeJsonEmojiUsage :: EncodeJson EmojiUsage where
  encodeJson = show >>> encodeJson

instance decdoeHasuraEmojiUsage :: DecodeHasura EmojiUsage where
  decodeHasura = decodeJson

instance encodeHasuraEmojiUsage :: EncodeHasura EmojiUsage where
  encodeHasura = encodeJson

instance showEmojiUsage :: Show EmojiUsage where
  show a = case a of
    EXISTING_REACTION_ONLY -> "EXISTING_REACTION_ONLY"
    ANYWHERE -> "ANYWHERE"

instance enumEmojiUsage :: Enum EmojiUsage where
  succ a = case a of
    EXISTING_REACTION_ONLY -> Just ANYWHERE
    ANYWHERE -> Nothing
  pred a = case a of
    EXISTING_REACTION_ONLY -> Nothing
    ANYWHERE -> Just EXISTING_REACTION_ONLY

instance boundedEmojiUsage :: Bounded EmojiUsage where
  top = ANYWHERE
  bottom = EXISTING_REACTION_ONLY

instance boundedEnumEmojiUsage :: BoundedEnum EmojiUsage where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just EXISTING_REACTION_ONLY
    1 -> Just ANYWHERE
    _ -> Nothing
  fromEnum a = case a of
    EXISTING_REACTION_ONLY -> 0
    ANYWHERE -> 1

