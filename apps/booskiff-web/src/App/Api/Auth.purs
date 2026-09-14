module App.Api.Auth where

import Prelude

import App.Api.Client as Api
import Data.Argonaut.Decode.Class (class DecodeJson, decodeJson)
import Data.Argonaut.Decode.Combinators ((.:), (.:?))
import Data.Either (Either)
import Data.Maybe (Maybe)
import Effect.Aff (Aff)

-- | POST /auth/login body (identifier = email or username)
type LoginRequest =
  { identifier :: String
  , password :: String
  }

-- | Login response from BFF
newtype LoginResponse = LoginResponse { authenticated :: Boolean, username :: String, next :: Maybe String }

instance DecodeJson LoginResponse where
  decodeJson json = do
    obj <- decodeJson json
    authenticated <- obj .: "authenticated"
    username <- obj .: "username"
    next <- obj .:? "next"
    pure (LoginResponse { authenticated, username, next })

-- | Session response from BFF (GET /auth/session)
newtype SessionResponse = SessionResponse { authenticated :: Boolean, username :: String }

instance DecodeJson SessionResponse where
  decodeJson json = do
    obj <- decodeJson json
    authenticated <- obj .: "authenticated"
    username <- obj .: "username"
    pure (SessionResponse { authenticated, username })

-- | POST /auth/login
login :: LoginRequest -> Aff (Either String LoginResponse)
login = Api.postJson "/auth/login"

-- | GET /auth/session
session :: Aff (Either String SessionResponse)
session = Api.get "/auth/session"

-- | POST /auth/logout (session cookie is cleared by the BFF)
logout :: Aff (Either String Unit)
logout = Api.postUnit "/auth/logout"
