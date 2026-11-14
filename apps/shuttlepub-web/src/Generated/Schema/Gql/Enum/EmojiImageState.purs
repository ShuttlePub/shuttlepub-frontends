module Generated.Schema.Gql.Enum.EmojiImageState where

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

-- | EmojiImageState: whether the image of a custom emoji can be shown (independent of availability).
data EmojiImageState
  = PRESENT
  | MISSING

instance eqEmojiImageState :: Eq EmojiImageState where
  eq = eq `on` show

instance ordEmojiImageState :: Ord EmojiImageState where
  compare = compare `on` show

instance gqlArgStringEmojiImageState :: GqlArgString EmojiImageState where
  toGqlArgStringImpl = show

instance decodeJsonEmojiImageState :: DecodeJson EmojiImageState where
  decodeJson = decodeJson >=> case _ of
    "PRESENT" -> pure PRESENT
    "MISSING" -> pure MISSING
    s -> Left $ TypeMismatch $ "Not a EmojiImageState: " <> s

instance encodeJsonEmojiImageState :: EncodeJson EmojiImageState where
  encodeJson = show >>> encodeJson

instance decdoeHasuraEmojiImageState :: DecodeHasura EmojiImageState where
  decodeHasura = decodeJson

instance encodeHasuraEmojiImageState :: EncodeHasura EmojiImageState where
  encodeHasura = encodeJson

instance showEmojiImageState :: Show EmojiImageState where
  show a = case a of
    PRESENT -> "PRESENT"
    MISSING -> "MISSING"

instance enumEmojiImageState :: Enum EmojiImageState where
  succ a = case a of
    PRESENT -> Just MISSING
    MISSING -> Nothing
  pred a = case a of
    PRESENT -> Nothing
    MISSING -> Just PRESENT

instance boundedEmojiImageState :: Bounded EmojiImageState where
  top = MISSING
  bottom = PRESENT

instance boundedEnumEmojiImageState :: BoundedEnum EmojiImageState where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just PRESENT
    1 -> Just MISSING
    _ -> Nothing
  fromEnum a = case a of
    PRESENT -> 0
    MISSING -> 1

