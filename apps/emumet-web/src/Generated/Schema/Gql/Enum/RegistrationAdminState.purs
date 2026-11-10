module Generated.Schema.Gql.Enum.RegistrationAdminState where

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

data RegistrationAdminState
  = OPEN
  | CLOSED

instance eqRegistrationAdminState :: Eq RegistrationAdminState where
  eq = eq `on` show

instance ordRegistrationAdminState :: Ord RegistrationAdminState where
  compare = compare `on` show

instance gqlArgStringRegistrationAdminState :: GqlArgString RegistrationAdminState where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationAdminState :: DecodeJson RegistrationAdminState where
  decodeJson = decodeJson >=> case _ of
    "OPEN" -> pure OPEN
    "CLOSED" -> pure CLOSED
    s -> Left $ TypeMismatch $ "Not a RegistrationAdminState: " <> s

instance encodeJsonRegistrationAdminState :: EncodeJson RegistrationAdminState where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationAdminState :: DecodeHasura RegistrationAdminState where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationAdminState :: EncodeHasura RegistrationAdminState where
  encodeHasura = encodeJson

instance showRegistrationAdminState :: Show RegistrationAdminState where
  show a = case a of
    OPEN -> "OPEN"
    CLOSED -> "CLOSED"

instance enumRegistrationAdminState :: Enum RegistrationAdminState where
  succ a = case a of
    OPEN -> Just CLOSED
    CLOSED -> Nothing
  pred a = case a of
    OPEN -> Nothing
    CLOSED -> Just OPEN

instance boundedRegistrationAdminState :: Bounded RegistrationAdminState where
  top = CLOSED
  bottom = OPEN

instance boundedEnumRegistrationAdminState :: BoundedEnum RegistrationAdminState where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just OPEN
    1 -> Just CLOSED
    _ -> Nothing
  fromEnum a = case a of
    OPEN -> 0
    CLOSED -> 1

