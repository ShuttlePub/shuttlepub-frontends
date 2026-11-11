module Generated.Schema.Gql.Enum.ProfileUsernameCheck where

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

-- | 規則だけの判定結果。重複・設定済みは書き込み時にしか判明しない
data ProfileUsernameCheck
  = VALID
  | FORMAT
  | RESERVED

instance eqProfileUsernameCheck :: Eq ProfileUsernameCheck where
  eq = eq `on` show

instance ordProfileUsernameCheck :: Ord ProfileUsernameCheck where
  compare = compare `on` show

instance gqlArgStringProfileUsernameCheck :: GqlArgString ProfileUsernameCheck where
  toGqlArgStringImpl = show

instance decodeJsonProfileUsernameCheck :: DecodeJson ProfileUsernameCheck where
  decodeJson = decodeJson >=> case _ of
    "VALID" -> pure VALID
    "FORMAT" -> pure FORMAT
    "RESERVED" -> pure RESERVED
    s -> Left $ TypeMismatch $ "Not a ProfileUsernameCheck: " <> s

instance encodeJsonProfileUsernameCheck :: EncodeJson ProfileUsernameCheck where
  encodeJson = show >>> encodeJson

instance decdoeHasuraProfileUsernameCheck :: DecodeHasura ProfileUsernameCheck where
  decodeHasura = decodeJson

instance encodeHasuraProfileUsernameCheck :: EncodeHasura ProfileUsernameCheck where
  encodeHasura = encodeJson

instance showProfileUsernameCheck :: Show ProfileUsernameCheck where
  show a = case a of
    VALID -> "VALID"
    FORMAT -> "FORMAT"
    RESERVED -> "RESERVED"

instance enumProfileUsernameCheck :: Enum ProfileUsernameCheck where
  succ a = case a of
    VALID -> Just FORMAT
    FORMAT -> Just RESERVED
    RESERVED -> Nothing
  pred a = case a of
    VALID -> Nothing
    FORMAT -> Just VALID
    RESERVED -> Just FORMAT

instance boundedProfileUsernameCheck :: Bounded ProfileUsernameCheck where
  top = RESERVED
  bottom = VALID

instance boundedEnumProfileUsernameCheck :: BoundedEnum ProfileUsernameCheck where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just VALID
    1 -> Just FORMAT
    2 -> Just RESERVED
    _ -> Nothing
  fromEnum a = case a of
    VALID -> 0
    FORMAT -> 1
    RESERVED -> 2

