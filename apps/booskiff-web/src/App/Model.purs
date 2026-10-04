module App.Model where

import Prelude

import App.Route (Route)
import App.Route as Route
import Data.Argonaut.Core (jsonEmptyObject)
import Data.Argonaut.Decode.Class (class DecodeJson, decodeJson)
import Data.Argonaut.Decode.Combinators ((.:), (.:?))
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Combinators ((:=), (~>))
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..), maybe)
import Data.Show.Generic (genericShow)

data PageModel = Login | Drive | FileDetail String | NotFound

derive instance Generic PageModel _
derive instance Eq PageModel

instance Show PageModel where
  show = genericShow

instance EncodeJson PageModel where
  encodeJson = genericEncodeJson

instance DecodeJson PageModel where
  decodeJson = genericDecodeJson

-- | Async load state for remote resources. `Failed` carries an error message.
data RemoteData a = NotAsked | Loading | Failed String | Loaded a

derive instance Generic (RemoteData a) _
derive instance Eq a => Eq (RemoteData a)

instance Show a => Show (RemoteData a) where
  show = genericShow

instance EncodeJson a => EncodeJson (RemoteData a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (RemoteData a) where
  decodeJson = genericDecodeJson

-- | A file entry from the Booskiff core API (camelCase JSON).
newtype FileItem = FileItem
  { id :: String
  , name :: String
  , mimeType :: String
  , sizeBytes :: Number
  , folderId :: Maybe String
  , isPublic :: Boolean
  , createdAt :: String
  }

derive newtype instance Eq FileItem
derive newtype instance Show FileItem

instance EncodeJson FileItem where
  encodeJson (FileItem r) =
    "id" := r.id
      ~> "name" := r.name
      ~> "mimeType" := r.mimeType
      ~> "sizeBytes" := r.sizeBytes
      ~> "folderId" := r.folderId
      ~> "isPublic" := r.isPublic
      ~> "createdAt" := r.createdAt
      ~> jsonEmptyObject

-- | Hand-written decode so that a missing or null `folderId` (root-level
-- | files) is tolerated; encoding always writes the key (null for Nothing).
instance DecodeJson FileItem where
  decodeJson json = do
    obj <- decodeJson json
    vId <- obj .: "id"
    vName <- obj .: "name"
    vMimeType <- obj .: "mimeType"
    vSizeBytes <- obj .: "sizeBytes"
    vFolderId <- obj .:? "folderId"
    vIsPublic <- obj .: "isPublic"
    vCreatedAt <- obj .: "createdAt"
    pure $ FileItem
      { id: vId
      , name: vName
      , mimeType: vMimeType
      , sizeBytes: vSizeBytes
      , folderId: vFolderId
      , isPublic: vIsPublic
      , createdAt: vCreatedAt
      }

newtype Folder = Folder
  { id :: String
  , name :: String
  , parentId :: Maybe String
  , createdAt :: String
  }

derive newtype instance Eq Folder
derive newtype instance Show Folder

instance EncodeJson Folder where
  encodeJson (Folder r) =
    "id" := r.id
      ~> "name" := r.name
      ~> "parentId" := r.parentId
      ~> "createdAt" := r.createdAt
      ~> jsonEmptyObject

instance DecodeJson Folder where
  decodeJson json = do
    obj <- decodeJson json
    vId <- obj .: "id"
    vName <- obj .: "name"
    vParentId <- obj .:? "parentId"
    vCreatedAt <- obj .: "createdAt"
    pure $ Folder { id: vId, name: vName, parentId: vParentId, createdAt: vCreatedAt }

newtype Billing = Billing
  { usedBytes :: Number
  , storageQuotaBytes :: Number
  , maxFileBytes :: Number
  , rateLimitRpm :: Int
  }

derive newtype instance Eq Billing
derive newtype instance Show Billing

instance EncodeJson Billing where
  encodeJson (Billing r) =
    "usedBytes" := r.usedBytes
      ~> "storageQuotaBytes" := r.storageQuotaBytes
      ~> "maxFileBytes" := r.maxFileBytes
      ~> "rateLimitRpm" := r.rateLimitRpm
      ~> jsonEmptyObject

instance DecodeJson Billing where
  decodeJson json = do
    obj <- decodeJson json
    vUsedBytes <- obj .: "usedBytes"
    vStorageQuotaBytes <- obj .: "storageQuotaBytes"
    vMaxFileBytes <- obj .: "maxFileBytes"
    vRateLimitRpm <- obj .: "rateLimitRpm"
    pure $ Billing
      { usedBytes: vUsedBytes
      , storageQuotaBytes: vStorageQuotaBytes
      , maxFileBytes: vMaxFileBytes
      , rateLimitRpm: vRateLimitRpm
      }

-- | Session info from the BFF (GET /auth/session)
type SessionInfo =
  { username :: String
  }

-- | Form state for login
type LoginForm =
  { identifier :: String
  , password :: String
  }

emptyLoginForm :: LoginForm
emptyLoginForm = { identifier: "", password: "" }

-- | Form state for creating/renaming a folder.
-- | `editing`: Nothing = creating new, Just id = renaming existing.
type FolderForm =
  { name :: String
  , editing :: Maybe String
  }

emptyFolderForm :: FolderForm
emptyFolderForm = { name: "", editing: Nothing }

-- | Upload progress state (Nothing = no upload in flight)
type UploadState =
  { id :: String
  , name :: String
  , destinationId :: String
  , destinationName :: String
  , status :: String
  , loaded :: Number
  , total :: Number
  , error :: String
  , retryable :: Boolean
  }

type DownloadRequest = { id :: String, name :: String }

type Model =
  { route :: Maybe Route
  , page :: PageModel
  , isHydrated :: Boolean
  , session :: Maybe SessionInfo
  , loginForm :: LoginForm
  , files :: RemoteData (Array FileItem)
  , detail :: RemoteData (Array FileItem)
  , folders :: RemoteData (Array Folder)
  , billing :: RemoteData Billing
  , uploads :: Array UploadState
  , downloads :: Array DownloadRequest
  , transferExpanded :: Boolean
  , viewMode :: String
  , search :: String
  , sort :: String
  , dataEpoch :: Int
  , filesEpoch :: Int
  , billingEpoch :: Int
  , folderFormOpen :: Boolean
  , selectedFolder :: Maybe String
  , folderForm :: FolderForm
  , errorMessage :: Maybe String
  , busy :: Boolean
  }

-- | Initial model used by SSR (and as the base for tests).
-- | The server cannot know the session, so `session` is always Nothing here.
initialModel :: Maybe Route -> Model
initialModel mRoute =
  { route: mRoute
  , page: pageForMaybeRoute mRoute
  , isHydrated: false
  , session: Nothing
  , loginForm: emptyLoginForm
  , files: NotAsked
  , detail: NotAsked
  , folders: NotAsked
  , billing: NotAsked
  , uploads: []
  , downloads: []
  , transferExpanded: true
  , viewMode: "list"
  , search: ""
  , sort: "name"
  , dataEpoch: 0
  , filesEpoch: 0
  , billingEpoch: 0
  , folderFormOpen: false
  , selectedFolder: folderForRoute mRoute
  , folderForm: emptyFolderForm
  , errorMessage: Nothing
  , busy: false
  }

pageForRoute :: Route -> PageModel
pageForRoute = case _ of
  Route.Login -> Login
  Route.Drive -> Drive
  Route.FolderDetail _ -> Drive
  Route.FileDetail fileId -> FileDetail fileId

-- | Check if a route requires authentication
isProtectedRoute :: Route -> Boolean
isProtectedRoute = case _ of
  Route.Login -> false
  Route.Drive -> true
  Route.FolderDetail _ -> true
  Route.FileDetail _ -> true

pageForMaybeRoute :: Maybe Route -> PageModel
pageForMaybeRoute = maybe NotFound pageForRoute

folderForRoute :: Maybe Route -> Maybe String
folderForRoute = case _ of
  Just (Route.FolderDetail id) -> Just id
  _ -> Nothing

isDriveRoute :: Maybe Route -> Boolean
isDriveRoute = case _ of
  Just Route.Drive -> true
  Just (Route.FolderDetail _) -> true
  _ -> false
