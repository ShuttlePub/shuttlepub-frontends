module App.Username where

import Prelude

import Data.Array (all, elem, uncons)
import Data.Argonaut.Decode (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.String.CodeUnits (length, toCharArray)

-- | Profile username rules (Emumet E8/P1): ^[a-z0-9][a-z0-9._-]{0,63}$, plus a
-- | reserved-word list. No implicit trimming or case folding: an uppercase
-- | letter is a format error (the UI never converts it).

maxLength :: Int
maxLength = 64

reservedWords :: Array String
reservedWords =
  [ "admin"
  , "administrator"
  , "root"
  , "system"
  , "support"
  , "security"
  , "moderator"
  , "api"
  , "ap"
  , "auth"
  , "oauth"
  , "oauth2"
  , "login"
  , "logout"
  , "register"
  , "settings"
  , "well-known"
  ]

-- | Result of the rules that can be checked locally while typing.
data Local = Empty | TooLong | BadFormat | Reserved | LocalOk

derive instance Eq Local

instance Show Local where
  show = case _ of
    Empty -> "Empty"
    TooLong -> "TooLong"
    BadFormat -> "BadFormat"
    Reserved -> "Reserved"
    LocalOk -> "LocalOk"

validate :: String -> Local
validate value =
  if value == "" then Empty
  else if length value > maxLength then TooLong
  else if not (formatOk value) then BadFormat
  else if value `elem` reservedWords then Reserved
  else LocalOk

formatOk :: String -> Boolean
formatOk value = case uncons (toCharArray value) of
  Nothing -> false
  Just { head, tail } -> isHead head && all isRest tail

isHead :: Char -> Boolean
isHead c = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')

isRest :: Char -> Boolean
isRest c = isHead c || c == '.' || c == '_' || c == '-'

data Reason = ReasonFormat | ReasonReserved

derive instance Eq Reason

derive instance Generic Reason _

instance EncodeJson Reason where
  encodeJson = genericEncodeJson

instance DecodeJson Reason where
  decodeJson = genericDecodeJson

-- | Outcome of the server-side judgement for the value currently in the field.
-- | Unverified: not asked yet / the question is in flight.
-- | Taken: the server refused a submission because the name is already in use.
-- | Unavailable: the server could not be asked.
data Verdict = Unverified | Verified | Rejected Reason | Taken | Unavailable

derive instance Eq Verdict

derive instance Generic Verdict _

instance EncodeJson Verdict where
  encodeJson = genericEncodeJson

instance DecodeJson Verdict where
  decodeJson = genericDecodeJson

-- | What the single status line under the input shows.
data Status = NoStatus | Checking | Available | Unusable String

derive instance Eq Status

instance Show Status where
  show = case _ of
    NoStatus -> "NoStatus"
    Checking -> "Checking"
    Available -> "Available"
    Unusable m -> "Unusable " <> show m

formatMessage :: String
formatMessage = "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます"

tooLongMessage :: String
tooLongMessage = "長すぎます"

unusableMessage :: String
unusableMessage = "利用できません"

unavailableMessage :: String
unavailableMessage = "確認できませんでした。もう一度お試しください"

status :: String -> Verdict -> Status
status value verdict = case validate value of
  Empty -> NoStatus
  TooLong -> Unusable tooLongMessage
  BadFormat -> Unusable formatMessage
  Reserved -> Unusable unusableMessage
  LocalOk -> case verdict of
    Unverified -> Checking
    Verified -> Available
    Rejected ReasonFormat -> Unusable formatMessage
    Rejected ReasonReserved -> Unusable unusableMessage
    Taken -> Unusable unusableMessage
    Unavailable -> Unusable unavailableMessage

-- | The create / set buttons are enabled only when the name is "available".
isAvailable :: String -> Verdict -> Boolean
isAvailable value verdict = status value verdict == Available

-- | A value that passes the local rules is worth asking the server about.
shouldAskServer :: String -> Boolean
shouldAskServer value = validate value == LocalOk
