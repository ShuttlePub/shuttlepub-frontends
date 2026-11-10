module Generated.Schema.Gql.Enum.RegistrationProtection where

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

data RegistrationProtection
  = EMAIL
  | BOT

instance eqRegistrationProtection :: Eq RegistrationProtection where
  eq = eq `on` show

instance ordRegistrationProtection :: Ord RegistrationProtection where
  compare = compare `on` show

instance gqlArgStringRegistrationProtection :: GqlArgString RegistrationProtection where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationProtection :: DecodeJson RegistrationProtection where
  decodeJson = decodeJson >=> case _ of
    "EMAIL" -> pure EMAIL
    "BOT" -> pure BOT
    s -> Left $ TypeMismatch $ "Not a RegistrationProtection: " <> s

instance encodeJsonRegistrationProtection :: EncodeJson RegistrationProtection where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationProtection :: DecodeHasura RegistrationProtection where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationProtection :: EncodeHasura RegistrationProtection where
  encodeHasura = encodeJson

instance showRegistrationProtection :: Show RegistrationProtection where
  show a = case a of
    EMAIL -> "EMAIL"
    BOT -> "BOT"

instance enumRegistrationProtection :: Enum RegistrationProtection where
  succ a = case a of
    EMAIL -> Just BOT
    BOT -> Nothing
  pred a = case a of
    EMAIL -> Nothing
    BOT -> Just EMAIL

instance boundedRegistrationProtection :: Bounded RegistrationProtection where
  top = BOT
  bottom = EMAIL

instance boundedEnumRegistrationProtection :: BoundedEnum RegistrationProtection where
  cardinality = Cardinality 2
  toEnum a = case a of
    0 -> Just EMAIL
    1 -> Just BOT
    _ -> Nothing
  fromEnum a = case a of
    EMAIL -> 0
    BOT -> 1

