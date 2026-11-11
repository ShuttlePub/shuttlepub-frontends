module Generated.Schema.Gql.Enum.PolicyMode where

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

-- | Mute or block (personal-domain-controls). Settings belong to one Profile and never apply to
-- | other Profiles or Accounts. A block also detaches existing follows in both directions in
-- | Emumet; removing it restores nothing.
data PolicyMode
  = MUTE
  | BLOCK

instance eqPolicyMode :: Eq PolicyMode where
  eq = eq `on` show

instance ordPolicyMode :: Ord PolicyMode where
  compare = compare `on` show

instance gqlArgStringPolicyMode :: GqlArgString PolicyMode where
  toGqlArgStringImpl = show

instance decodeJsonPolicyMode :: DecodeJson PolicyMode where
  decodeJson = decodeJson >=> case _ of
    "MUTE" -> pure MUTE
    "BLOCK" -> pure BLOCK
    s -> Left $ TypeMismatch $ "Not a PolicyMode: " <> s

instance encodeJsonPolicyMode :: EncodeJson PolicyMode where
  encodeJson = show >>> encodeJson

instance decdoeHasuraPolicyMode :: DecodeHasura PolicyMode where
  decodeHasura = decodeJson

instance encodeHasuraPolicyMode :: EncodeHasura PolicyMode where
  encodeHasura = encodeJson

instance showPolicyMode :: Show PolicyMode where
  show a = case a of
    MUTE -> "MUTE"
    BLOCK -> "BLOCK"

instance enumPolicyMode :: Enum PolicyMode where
  succ a = case a of
    MUTE -> Just BLOCK
    BLOCK -> Nothing
  pred a = case a of
    MUTE -> Nothing
    BLOCK -> Just MUTE

instance boundedPolicyMode :: Bounded PolicyMode where
  top = BLOCK
  bottom = MUTE

instance boundedEnumPolicyMode :: BoundedEnum PolicyMode where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just MUTE
    1 -> Just BLOCK
    _ -> Nothing
  fromEnum a = case a of
    MUTE -> 0
    BLOCK -> 1

