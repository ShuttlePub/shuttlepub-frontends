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

-- | 入力中の検証結果。VALID = 形式・予約語を満たし、Emumet の空き確認で使用中ではないことを確認できた。
-- | TAKEN = 使用中 (削除済み Profile の使用を含む。区別しない)。UNKNOWN = 形式・予約語は満たすが空きを確認できなかった
-- | (接続不可・時間切れ・429・契約違反)。UNKNOWN を「利用できる」として扱ってはいけない。
-- | 結果は参考値で、最終判定は作成 / 設定時の拒否 (USERNAME_TAKEN 等)
data ProfileUsernameCheck
  = VALID
  | FORMAT
  | RESERVED
  | TAKEN
  | UNKNOWN

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
    "TAKEN" -> pure TAKEN
    "UNKNOWN" -> pure UNKNOWN
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
    TAKEN -> "TAKEN"
    UNKNOWN -> "UNKNOWN"

instance enumProfileUsernameCheck :: Enum ProfileUsernameCheck where
  succ a = case a of
    VALID -> Just FORMAT
    FORMAT -> Just RESERVED
    RESERVED -> Just TAKEN
    TAKEN -> Just UNKNOWN
    UNKNOWN -> Nothing
  pred a = case a of
    VALID -> Nothing
    FORMAT -> Just VALID
    RESERVED -> Just FORMAT
    TAKEN -> Just RESERVED
    UNKNOWN -> Just TAKEN

instance boundedProfileUsernameCheck :: Bounded ProfileUsernameCheck where
  top = UNKNOWN
  bottom = VALID

instance boundedEnumProfileUsernameCheck :: BoundedEnum ProfileUsernameCheck where
  cardinality = Cardinality 5
  toEnum a = case a of
    0 -> Just VALID
    1 -> Just FORMAT
    2 -> Just RESERVED
    3 -> Just TAKEN
    4 -> Just UNKNOWN
    _ -> Nothing
  fromEnum a = case a of
    VALID -> 0
    FORMAT -> 1
    RESERVED -> 2
    TAKEN -> 3
    UNKNOWN -> 4

