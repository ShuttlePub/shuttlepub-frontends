module App.Api.Client where

import Prelude

import Affjax.ResponseFormat as AXRF
import Affjax.StatusCode (StatusCode(..))
import Affjax.Web as AX
import Affjax.RequestBody as AXRB
import Data.Argonaut.Core (Json)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, printJsonDecodeError)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Bifunctor (lmap)
import Data.Either (Either(..))
import Data.HTTP.Method (Method(..))
import Data.Maybe (Maybe(..))
import Effect.Aff (Aff)

-- | API error type
data ApiError
  = NetworkError String
  | HttpError Int String
  | DecodeError String
  -- | A GraphQL error the BFF classified with extensions.code (username
  -- | rejections, forbidden, unsupported, ...). The message is user-facing.
  | CodedError String String

printApiError :: ApiError -> String
printApiError = case _ of
  CodedError code msg -> codedErrorMessage code msg
  NetworkError msg -> "Network error: " <> msg
  HttpError code msg -> "HTTP " <> show code <> ": " <> msg
  DecodeError msg -> "Decode error: " <> msg

-- | User-facing text for a classified BFF error.
codedErrorMessage :: String -> String -> String
codedErrorMessage code fallback = case code of
  "USERNAME_INVALID_FORMAT" -> "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます"
  "USERNAME_RESERVED" -> "利用できません"
  "USERNAME_TAKEN" -> "利用できません"
  "USERNAME_ALREADY_SET" -> "ユーザー名はすでに設定されています (変更できません)"
  "USERNAME_CONFLICT" -> "ユーザー名を設定できませんでした (使用済みか、すでに設定されています)"
  "ACCOUNT_RESTRICTED" -> "このアカウントは停止中のため設定できません"
  "FORBIDDEN" -> "この操作は許可されていません"
  "BAD_REQUEST" -> "入力内容を確認してください"
  "TEMPORARILY_UNAVAILABLE" -> "一時的に利用できません。しばらくしてからやり直してください"
  "UNSUPPORTED" -> "この操作は現在サポートされていません"
  _ -> fallback

-- | Make a request and decode JSON response
request :: forall a. DecodeJson a => AX.Request Json -> Aff (Either ApiError a)
request req = do
  result <- AX.request req
  pure $ case result of
    Left err -> Left $ NetworkError (AX.printError err)
    Right response ->
      let
        StatusCode code = response.status
      in
        if code >= 200 && code < 300 then lmap (DecodeError <<< printJsonDecodeError) (decodeJson response.body)
        else Left $ HttpError code response.statusText

-- | GET with JSON response
get :: forall a. DecodeJson a => String -> Aff (Either ApiError a)
get url = request $ AX.defaultRequest
  { url = url
  , method = Left GET
  , responseFormat = AXRF.json
  }

-- | POST with JSON body and JSON response
post :: forall req res. EncodeJson req => DecodeJson res => String -> req -> Aff (Either ApiError res)
post url body = request $ AX.defaultRequest
  { url = url
  , method = Left POST
  , content = Just $ AXRB.json (encodeJson body)
  , responseFormat = AXRF.json
  }

-- | PUT with JSON body and JSON response
put :: forall req res. EncodeJson req => DecodeJson res => String -> req -> Aff (Either ApiError res)
put url body = request $ AX.defaultRequest
  { url = url
  , method = Left PUT
  , content = Just $ AXRB.json (encodeJson body)
  , responseFormat = AXRF.json
  }

-- | DELETE with no body
delete :: String -> Aff (Either ApiError Unit)
delete url = do
  result <- AX.request $ AX.defaultRequest
    { url = url
    , method = Left DELETE
    , responseFormat = AXRF.ignore
    }
  pure $ case result of
    Left err -> Left $ NetworkError (AX.printError err)
    Right response ->
      let
        StatusCode code = response.status
      in
        if code >= 200 && code < 300 then Right unit
        else Left $ HttpError code response.statusText

-- | PUT with JSON body and no response body (e.g. 204 No Content)
putUnit :: forall req. EncodeJson req => String -> req -> Aff (Either ApiError Unit)
putUnit url body = do
  result <- AX.request $ AX.defaultRequest
    { url = url
    , method = Left PUT
    , content = Just $ AXRB.json (encodeJson body)
    , responseFormat = AXRF.ignore
    }
  pure $ case result of
    Left err -> Left $ NetworkError (AX.printError err)
    Right response ->
      let
        StatusCode code = response.status
      in
        if code >= 200 && code < 300 then Right unit
        else Left $ HttpError code response.statusText
