module Generated.Schema.Gql.Enum.RegistrationHealthEpisode where

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

-- | 継続中の健全性 episode。OUTAGE 一時障害で effective な対策が 0 件 / DEGRADED 片方のみ障害 (防御低下)
data RegistrationHealthEpisode
  = NONE
  | OUTAGE
  | DEGRADED

instance eqRegistrationHealthEpisode :: Eq RegistrationHealthEpisode where
  eq = eq `on` show

instance ordRegistrationHealthEpisode :: Ord RegistrationHealthEpisode where
  compare = compare `on` show

instance gqlArgStringRegistrationHealthEpisode :: GqlArgString RegistrationHealthEpisode where
  toGqlArgStringImpl = show

instance decodeJsonRegistrationHealthEpisode :: DecodeJson RegistrationHealthEpisode where
  decodeJson = decodeJson >=> case _ of
    "NONE" -> pure NONE
    "OUTAGE" -> pure OUTAGE
    "DEGRADED" -> pure DEGRADED
    s -> Left $ TypeMismatch $ "Not a RegistrationHealthEpisode: " <> s

instance encodeJsonRegistrationHealthEpisode :: EncodeJson RegistrationHealthEpisode where
  encodeJson = show >>> encodeJson

instance decdoeHasuraRegistrationHealthEpisode :: DecodeHasura RegistrationHealthEpisode where
  decodeHasura = decodeJson

instance encodeHasuraRegistrationHealthEpisode :: EncodeHasura RegistrationHealthEpisode where
  encodeHasura = encodeJson

instance showRegistrationHealthEpisode :: Show RegistrationHealthEpisode where
  show a = case a of
    NONE -> "NONE"
    OUTAGE -> "OUTAGE"
    DEGRADED -> "DEGRADED"

instance enumRegistrationHealthEpisode :: Enum RegistrationHealthEpisode where
  succ a = case a of
    NONE -> Just OUTAGE
    OUTAGE -> Just DEGRADED
    DEGRADED -> Nothing
  pred a = case a of
    NONE -> Nothing
    OUTAGE -> Just NONE
    DEGRADED -> Just OUTAGE

instance boundedRegistrationHealthEpisode :: Bounded RegistrationHealthEpisode where
  top = DEGRADED
  bottom = NONE

instance boundedEnumRegistrationHealthEpisode :: BoundedEnum RegistrationHealthEpisode where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just NONE
    1 -> Just OUTAGE
    2 -> Just DEGRADED
    _ -> Nothing
  fromEnum a = case a of
    NONE -> 0
    OUTAGE -> 1
    DEGRADED -> 2

