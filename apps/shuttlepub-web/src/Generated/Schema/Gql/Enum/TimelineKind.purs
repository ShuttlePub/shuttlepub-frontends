module Generated.Schema.Gql.Enum.TimelineKind where

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

-- | PROVISIONAL. Which timeline to read.
data TimelineKind
  = HOME
  | LOCAL
  | FEDERATED

instance eqTimelineKind :: Eq TimelineKind where
  eq = eq `on` show

instance ordTimelineKind :: Ord TimelineKind where
  compare = compare `on` show

instance gqlArgStringTimelineKind :: GqlArgString TimelineKind where
  toGqlArgStringImpl = show

instance decodeJsonTimelineKind :: DecodeJson TimelineKind where
  decodeJson = decodeJson >=> case _ of
    "HOME" -> pure HOME
    "LOCAL" -> pure LOCAL
    "FEDERATED" -> pure FEDERATED
    s -> Left $ TypeMismatch $ "Not a TimelineKind: " <> s

instance encodeJsonTimelineKind :: EncodeJson TimelineKind where
  encodeJson = show >>> encodeJson

instance decdoeHasuraTimelineKind :: DecodeHasura TimelineKind where
  decodeHasura = decodeJson

instance encodeHasuraTimelineKind :: EncodeHasura TimelineKind where
  encodeHasura = encodeJson

instance showTimelineKind :: Show TimelineKind where
  show a = case a of
    HOME -> "HOME"
    LOCAL -> "LOCAL"
    FEDERATED -> "FEDERATED"

instance enumTimelineKind :: Enum TimelineKind where
  succ a = case a of
    HOME -> Just LOCAL
    LOCAL -> Just FEDERATED
    FEDERATED -> Nothing
  pred a = case a of
    HOME -> Nothing
    LOCAL -> Just HOME
    FEDERATED -> Just LOCAL

instance boundedTimelineKind :: Bounded TimelineKind where
  top = FEDERATED
  bottom = HOME

instance boundedEnumTimelineKind :: BoundedEnum TimelineKind where
  cardinality = Cardinality 3
  toEnum a = case a of
    0 -> Just HOME
    1 -> Just LOCAL
    2 -> Just FEDERATED
    _ -> Nothing
  fromEnum a = case a of
    HOME -> 0
    LOCAL -> 1
    FEDERATED -> 2

