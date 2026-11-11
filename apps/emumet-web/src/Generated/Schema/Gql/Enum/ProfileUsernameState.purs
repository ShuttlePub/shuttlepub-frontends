module Generated.Schema.Gql.Enum.ProfileUsernameState where

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

data ProfileUsernameState
  = UNSET
  | SET

instance eqProfileUsernameState :: Eq ProfileUsernameState where
  eq = eq `on` show

instance ordProfileUsernameState :: Ord ProfileUsernameState where
  compare = compare `on` show

instance gqlArgStringProfileUsernameState :: GqlArgString ProfileUsernameState where
  toGqlArgStringImpl = show

instance decodeJsonProfileUsernameState :: DecodeJson ProfileUsernameState where
  decodeJson = decodeJson >=> case _ of
    "UNSET" -> pure UNSET
    "SET" -> pure SET
    s -> Left $ TypeMismatch $ "Not a ProfileUsernameState: " <> s

instance encodeJsonProfileUsernameState :: EncodeJson ProfileUsernameState where
  encodeJson = show >>> encodeJson

instance decdoeHasuraProfileUsernameState :: DecodeHasura ProfileUsernameState where
  decodeHasura = decodeJson

instance encodeHasuraProfileUsernameState :: EncodeHasura ProfileUsernameState where
  encodeHasura = encodeJson

instance showProfileUsernameState :: Show ProfileUsernameState where
  show a = case a of
    UNSET -> "UNSET"
    SET -> "SET"

instance enumProfileUsernameState :: Enum ProfileUsernameState where
  succ a = case a of
    UNSET -> Just SET
    SET -> Nothing
  pred a = case a of
    UNSET -> Nothing
    SET -> Just UNSET

instance boundedProfileUsernameState :: Bounded ProfileUsernameState where
  top = SET
  bottom = UNSET

instance boundedEnumProfileUsernameState :: BoundedEnum ProfileUsernameState where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just UNSET
    1 -> Just SET
    _ -> Nothing
  fromEnum a = case a of
    UNSET -> 0
    SET -> 1

