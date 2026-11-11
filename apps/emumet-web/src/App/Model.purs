module App.Model where

import Prelude

import App.Admin.Types (AdminModel)
import App.Api.GraphQL.Types (AccountResponse, MetadataResponse, ProfileResponse)
import App.Route (Route)
import App.Route as Route
import Data.Argonaut.Decode (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe, maybe)

data PageModel = Home | Login | Settings | AccountNew | AccountDetail | AdminRegistration | AdminWebhook | NotFound

derive instance Generic PageModel _
derive instance Eq PageModel

instance EncodeJson PageModel where
  encodeJson = genericEncodeJson

instance DecodeJson PageModel where
  decodeJson = genericDecodeJson

data RemoteData a = NotAsked | Loading | Failed | Loaded a

derive instance Generic (RemoteData a) _

instance EncodeJson a => EncodeJson (RemoteData a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (RemoteData a) where
  decodeJson = genericDecodeJson

type AccountWithDetails =
  { account :: AccountResponse
  , profile :: Maybe ProfileResponse
  , metadata :: Array MetadataResponse
  }

-- Session info from BFF (GET /auth/session)
type SessionInfo =
  { username :: String
  }

-- Form state for creating a new account
type NewAccountForm =
  { name :: String
  , isBot :: Boolean
  }

emptyNewAccountForm :: NewAccountForm
emptyNewAccountForm = { name: "", isBot: false }

-- Form state for login
type LoginForm =
  { identifier :: String
  , password :: String
  }

emptyLoginForm :: LoginForm
emptyLoginForm = { identifier: "", password: "" }

-- Form state for editing a profile (Nothing = not editing)
type EditProfileForm =
  { displayName :: String
  , summary :: String
  , iconUrl :: String
  , bannerUrl :: String
  }

-- Form state for adding/editing metadata (Nothing = not editing)
-- id: Nothing = creating new, Just nanoid = editing existing
type EditMetadataForm =
  { id :: Maybe String
  , label :: String
  , content :: String
  }

type Model =
  { route :: Maybe Route
  , page :: PageModel
  , isHydrated :: Boolean
  , session :: Maybe SessionInfo
  -- session がクライアントの GET /auth/session で確かめられたか。SSR (管理画面) が渡した session は未確認で、
  -- その直後の 401 (SessionFailed) は古い応答として捨てずに反映する
  , sessionVerified :: Boolean
  , loginForm :: LoginForm
  , accounts :: RemoteData (Array AccountResponse)
  , selectedAccount :: RemoteData AccountWithDetails
  , newAccountForm :: NewAccountForm
  , editProfileForm :: Maybe EditProfileForm
  , editMetadataForm :: Maybe EditMetadataForm
  , errorMessage :: Maybe String
  , savePending :: Boolean
  -- Monotonic counter incremented on each save-initiating action. Carried into
  -- in-flight save messages so handlers can ignore results from stale operations
  -- (e.g. user navigated away then back, or fired a second save).
  , saveGeneration :: Int
  -- 登録ゲート管理 (管理者のみ。nav のベル・管理画面・警告帯)
  , admin :: AdminModel
  }

pageForRoute :: Route -> PageModel
pageForRoute = case _ of
  Route.Home -> Home
  Route.Login -> Login
  Route.Settings -> Settings
  Route.AccountNew -> AccountNew
  Route.AccountDetail _ -> AccountDetail
  Route.AdminRegistration -> AdminRegistration
  Route.AdminWebhook -> AdminWebhook

-- | Check if a route requires authentication
isProtectedRoute :: Route -> Boolean
isProtectedRoute = case _ of
  Route.Login -> false
  _ -> true

pageForMaybeRoute :: Maybe Route -> PageModel
pageForMaybeRoute = maybe NotFound pageForRoute
