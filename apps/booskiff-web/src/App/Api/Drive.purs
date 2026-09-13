module App.Api.Drive where

import Prelude

import App.Api.Client as Api
import Affjax.Web as AX
import Affjax.ResponseFormat as AXRF
import App.Model (Billing, FileItem, Folder)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Argonaut.Decode.Combinators ((.:))
import Data.Either (Either(..))
import Data.HTTP.Method (Method(..))
import Data.Maybe (Maybe, maybe)
import Effect.Aff (Aff)

-- | List endpoints respond with the core-shaped `{ "items": [...] }` envelope;
-- | without this unwrapping, decoding a bare array always fails silently.
newtype Items a = Items (Array a)

instance decodeItems :: DecodeJson a => DecodeJson (Items a) where
  decodeJson json = do
    obj <- decodeJson json
    items <- obj .: "items"
    pure (Items items)

unwrapItems :: forall a. Items a -> Array a
unwrapItems (Items xs) = xs

-- | GET /api/files, optionally filtered by folder
listFiles :: Maybe String -> Aff (Either String (Array FileItem))
listFiles mFolderId = map (map unwrapItems) $ Api.get $ maybe "/api/files" (\id -> "/api/files?folder_id=" <> id) mFolderId

fileDetail :: String -> Aff (Either String (Array FileItem))
fileDetail id = do
  result <- Api.request $ AX.defaultRequest
    { url = "/api/files/" <> id
    , method = Left GET
    , responseFormat = AXRF.json
    }
  pure $ case result of
    Right file -> Right [ file ]
    Left (Api.HttpError 404 _) -> Right []
    Left err -> Left (Api.printApiError err)

-- | GET /api/folders
listFolders :: Aff (Either String (Array Folder))
listFolders = map (map unwrapItems) $ Api.get "/api/folders"

-- | POST /api/folders
createFolder :: String -> Aff (Either String Folder)
createFolder name = Api.postJson "/api/folders" { name }

-- | PATCH /api/folders/:id
renameFolder :: String -> String -> Aff (Either String Folder)
renameFolder id name = Api.patchJson ("/api/folders/" <> id) { name }

-- | DELETE /api/folders/:id
deleteFolder :: String -> Aff (Either String Unit)
deleteFolder id = Api.delete_ ("/api/folders/" <> id)

-- | DELETE /api/files/:id
deleteFile :: String -> Aff (Either String Unit)
deleteFile id = Api.delete_ ("/api/files/" <> id)

-- | GET /api/billing/status
billingStatus :: Aff (Either String Billing)
billingStatus = Api.get "/api/billing/status"
