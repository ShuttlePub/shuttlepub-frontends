module App.Api.GraphQL.Types where

import Prelude

import Data.Argonaut.Core (Json, isNull, jsonEmptyObject, jsonNull)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, (.:), (.:?))
import Data.Argonaut.Decode.Error (JsonDecodeError(..))
import Data.Argonaut.Encode (class EncodeJson, encodeJson, (:=), (~>))
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Foreign.Object as FO

-- Response DTOs (app-owned stable DTOs, decoupled from the BFF schema)

newtype AccountResponse = AccountResponse
  { createdAt :: String
  , displayName :: (Maybe String)
  , id :: String
  , isBot :: Boolean
  , moderation :: (Maybe ModerationResponse)
  , name :: String
  , profileId :: (Maybe String)
  , profileUsername :: (Maybe String)
  , publicKey :: (Maybe String)
  }

instance EncodeJson AccountResponse where
  encodeJson (AccountResponse r) =
    "created_at" := r.createdAt
      ~> "display_name" := r.displayName
      ~> "id" := r.id
      ~> "is_bot" := r.isBot
      ~> "moderation" := r.moderation
      ~> "name" := r.name
      ~> "profile_id" := r.profileId
      ~> "profile_username" := r.profileUsername
      ~> "public_key" := r.publicKey
      ~> jsonEmptyObject

instance DecodeJson AccountResponse where
  decodeJson json = do
    obj <- decodeJson json
    createdAt <- obj .: "created_at"
    displayName <- join <$> obj .:? "display_name"
    id <- obj .: "id"
    isBot <- obj .: "is_bot"
    moderation <- join <$> obj .:? "moderation"
    name <- obj .: "name"
    profileId <- join <$> obj .:? "profile_id"
    profileUsername <- join <$> obj .:? "profile_username"
    publicKey <- join <$> obj .:? "public_key"
    pure (AccountResponse { createdAt, displayName, id, isBot, moderation, name, profileId, profileUsername, publicKey })

newtype AccountsResponse = AccountsResponse
  { first :: (Maybe String)
  , items :: (Array AccountResponse)
  , last :: (Maybe String)
  }

instance EncodeJson AccountsResponse where
  encodeJson (AccountsResponse r) =
    "first" := r.first
      ~> "items" := r.items
      ~> "last" := r.last
      ~> jsonEmptyObject

instance DecodeJson AccountsResponse where
  decodeJson json = do
    obj <- decodeJson json
    first <- join <$> obj .:? "first"
    items <- obj .: "items"
    last <- join <$> obj .:? "last"
    pure (AccountsResponse { first, items, last })

newtype ProfileResponse = ProfileResponse
  { accountId :: String
  , bannerUrl :: (Maybe String)
  , displayName :: (Maybe String)
  , iconUrl :: (Maybe String)
  , nanoid :: String
  , summary :: (Maybe String)
  , username :: (Maybe String)
  }

instance EncodeJson ProfileResponse where
  encodeJson (ProfileResponse r) =
    "account_id" := r.accountId
      ~> "banner_url" := r.bannerUrl
      ~> "display_name" := r.displayName
      ~> "icon_url" := r.iconUrl
      ~> "nanoid" := r.nanoid
      ~> "summary" := r.summary
      ~> "username" := r.username
      ~> jsonEmptyObject

instance DecodeJson ProfileResponse where
  decodeJson json = do
    obj <- decodeJson json
    accountId <- obj .: "account_id"
    bannerUrl <- join <$> obj .:? "banner_url"
    displayName <- join <$> obj .:? "display_name"
    iconUrl <- join <$> obj .:? "icon_url"
    nanoid <- obj .: "nanoid"
    summary <- join <$> obj .:? "summary"
    username <- join <$> obj .:? "username"
    pure (ProfileResponse { accountId, bannerUrl, displayName, iconUrl, nanoid, summary, username })

newtype MetadataResponse = MetadataResponse
  { accountId :: String
  , content :: String
  , label :: String
  , nanoid :: String
  }

instance EncodeJson MetadataResponse where
  encodeJson (MetadataResponse r) =
    "account_id" := r.accountId
      ~> "content" := r.content
      ~> "label" := r.label
      ~> "nanoid" := r.nanoid
      ~> jsonEmptyObject

instance DecodeJson MetadataResponse where
  decodeJson json = do
    obj <- decodeJson json
    accountId <- obj .: "account_id"
    content <- obj .: "content"
    label <- obj .: "label"
    nanoid <- obj .: "nanoid"
    pure (MetadataResponse { accountId, content, label, nanoid })

-- ModerationResponse ADT
-- BFF flat Moderation type conversion:
--   type=SUSPENDED → Suspended { reason, suspendedAt, expiresAt }
--   type=BANNED → Banned { reason, bannedAt }
data ModerationResponse
  = Suspended
      { expiresAt :: (Maybe String)
      , reason :: String
      , suspendedAt :: String
      }
  | Banned
      { bannedAt :: String
      , reason :: String
      }

instance EncodeJson ModerationResponse where
  encodeJson (Suspended r) =
    "type" := "suspended"
      ~> "expires_at" := r.expiresAt
      ~> "reason" := r.reason
      ~> "suspended_at" := r.suspendedAt
      ~> jsonEmptyObject
  encodeJson (Banned r) =
    "type" := "banned"
      ~> "banned_at" := r.bannedAt
      ~> "reason" := r.reason
      ~> jsonEmptyObject

instance DecodeJson ModerationResponse where
  decodeJson json = do
    obj <- decodeJson json
    tag <- obj .: "type"
    case (tag :: String) of
      "suspended" -> do
        expiresAt <- join <$> obj .:? "expires_at"
        reason <- obj .: "reason"
        suspendedAt <- obj .: "suspended_at"
        pure (Suspended { expiresAt, reason, suspendedAt })
      "banned" -> do
        bannedAt <- obj .: "banned_at"
        reason <- obj .: "reason"
        pure (Banned { bannedAt, reason })
      other -> Left (UnexpectedValue (encodeJson other))

-- Tristate ADT for optional+nullable input fields
-- Omitted → field absent (no change)
-- SetNull → explicit null (clear value)
-- Value a → field has a value
data Tristate a = Omitted | SetNull | Value a

derive instance eqTristate :: Eq a => Eq (Tristate a)

instance showTristate :: Show a => Show (Tristate a) where
  show Omitted = "Omitted"
  show SetNull = "SetNull"
  show (Value a) = "(Value " <> show a <> ")"

instance encodeJsonTristate :: EncodeJson a => EncodeJson (Tristate a) where
  encodeJson Omitted = jsonNull
  encodeJson SetNull = jsonNull
  encodeJson (Value a) = encodeJson a

instance decodeJsonTristate :: DecodeJson a => DecodeJson (Tristate a) where
  decodeJson json = do
    (m :: Maybe a) <- decodeJson json
    pure case m of
      Nothing -> SetNull
      Just a -> Value a

-- | Insert a Tristate field into a Foreign.Object builder.
-- | Omitted → skip, SetNull → insert null, Value → insert encoded.
tristateField :: forall a. EncodeJson a => String -> Tristate a -> FO.Object Json -> FO.Object Json
tristateField _ Omitted obj = obj
tristateField key SetNull obj = FO.insert key jsonNull obj
tristateField key (Value a) obj = FO.insert key (encodeJson a) obj

-- | Decode a Tristate field from a decoded JSON object.
-- | Key absent → Omitted, key present+null → SetNull, key present+value → Value.
tristateDecodeField :: forall a. DecodeJson a => FO.Object Json -> String -> Either JsonDecodeError (Tristate a)
tristateDecodeField obj key = case FO.lookup key obj of
  Nothing -> Right Omitted
  Just json
    | isNull json -> Right SetNull
    | otherwise -> case decodeJson json of
        Left err -> Left err
        Right a -> Right (Value a)
