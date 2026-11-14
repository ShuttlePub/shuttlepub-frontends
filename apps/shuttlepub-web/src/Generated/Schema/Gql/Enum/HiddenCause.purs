module Generated.Schema.Gql.Enum.HiddenCause where

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

-- | S8 HiddenCause: why a note is hidden on direct open. DIRECT = its own author's domain is controlled; QUOTE = it directly quotes a note of a controlled domain (the control is the quoted source's).
data HiddenCause
  = DIRECT
  | QUOTE

instance eqHiddenCause :: Eq HiddenCause where
  eq = eq `on` show

instance ordHiddenCause :: Ord HiddenCause where
  compare = compare `on` show

instance gqlArgStringHiddenCause :: GqlArgString HiddenCause where
  toGqlArgStringImpl = show

instance decodeJsonHiddenCause :: DecodeJson HiddenCause where
  decodeJson = decodeJson >=> case _ of
    "DIRECT" -> pure DIRECT
    "QUOTE" -> pure QUOTE
    s -> Left $ TypeMismatch $ "Not a HiddenCause: " <> s

instance encodeJsonHiddenCause :: EncodeJson HiddenCause where
  encodeJson = show >>> encodeJson

instance decdoeHasuraHiddenCause :: DecodeHasura HiddenCause where
  decodeHasura = decodeJson

instance encodeHasuraHiddenCause :: EncodeHasura HiddenCause where
  encodeHasura = encodeJson

instance showHiddenCause :: Show HiddenCause where
  show a = case a of
    DIRECT -> "DIRECT"
    QUOTE -> "QUOTE"

instance enumHiddenCause :: Enum HiddenCause where
  succ a = case a of
    DIRECT -> Just QUOTE
    QUOTE -> Nothing
  pred a = case a of
    DIRECT -> Nothing
    QUOTE -> Just DIRECT

instance boundedHiddenCause :: Bounded HiddenCause where
  top = QUOTE
  bottom = DIRECT

instance boundedEnumHiddenCause :: BoundedEnum HiddenCause where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just DIRECT
    1 -> Just QUOTE
    _ -> Nothing
  fromEnum a = case a of
    DIRECT -> 0
    QUOTE -> 1

