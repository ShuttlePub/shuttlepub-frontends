module Test.Main where

import Prelude

import App.Format (humanize, mentionsSizeLimit, uploadErrorMessage)
import App.Model (Billing(..), FileItem(..), Folder(..), Model, RemoteData(..), initialModel)
import App.Route (Route(..), routeCodec)
import App.Model as Model
import App.Message (Message(..))
import App.View as View
import App.View.Drive (folderAncestors, visibleFiles, visibleFolders)
import Client.Update (mkUpdate)
import Data.Argonaut.Decode (class DecodeJson, decodeJson)
import Data.Argonaut.Encode (class EncodeJson, encodeJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either(..), hush)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains)
import Data.Tuple (fst)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Flame.Renderer.String (render)
import Routing.Duplex (parse, print)
import Foreign (unsafeToForeign)

main :: Effect Unit
main = do
  log "🧳 booskiff-web tests"
  testRouteCodec
  testModelRoundTrip
  testRemoteDataRoundTrip
  testFileItemDecode
  testBillingCamelCaseDecode
  testHumanize
  testUploadErrorMessage
  testFileDetailView
  testFileDetailLoaded
  testFileDetailLink
  testFolderRenameId
  testHierarchy
  testGrid
  testRequestIsolation
  testQueueFolderIsolation
  testBillingRequestIsolation

testBillingRequestIsolation :: Effect Unit
testBillingRequestIsolation = do
  let capacity usedBytes = Billing { usedBytes, storageQuotaBytes: 10240.0, maxFileBytes: 1024.0, rateLimitRpm: 60 }
  let first = update sampleModel (UploadCommitted sampleFile)
  let second = update first (UploadCommitted sampleFile)
  assertEqual "each upload creates a distinct capacity request" second.billingEpoch (first.billingEpoch + 1)
  let latest = update second (BillingLoaded second.billingEpoch (Right (capacity 200.0)))
  assertEqual "late capacity response cannot roll back usage"
    (update latest (BillingLoaded first.billingEpoch (Right (capacity 100.0)))).billing
    (Loaded (capacity 200.0))
  let deleted = update latest (FileDeleted latest.dataEpoch (Right "f1"))
  assertEqual "deletion also advances capacity request generation" deleted.billingEpoch (latest.billingEpoch + 1)
  let afterDelete = update deleted (BillingLoaded deleted.billingEpoch (Right (capacity 50.0)))
  assertEqual "the latest deletion may legitimately lower usage" afterDelete.billing (Loaded (capacity 50.0))
  assertEqual "old upload result cannot overwrite a newer deletion"
    (update afterDelete (BillingLoaded second.billingEpoch (Right (capacity 200.0)))).billing
    (Loaded (capacity 50.0))
  let reloaded = update afterDelete LoadDrive
  assertEqual "drive reload advances capacity request generation" reloaded.billingEpoch (afterDelete.billingEpoch + 1)
  assertEqual "late failure cannot overwrite a newer successful capacity result"
    (update afterDelete (BillingLoaded first.billingEpoch (Left "late network failure"))).billing
    afterDelete.billing
  let loading = update (sampleModel { files = Loading }) (UploadCommitted sampleFile)
  assertEqual "upload during list loading advances capacity generation" loading.billingEpoch (sampleModel.billingEpoch + 1)
  let logout = update reloaded LogoutDone
  assertEqual "logout invalidates outstanding capacity requests"
    (update logout (BillingLoaded reloaded.billingEpoch (Right (capacity 200.0)))).billing
    NotAsked

update :: Model -> Message -> Model
update model message = fst (mkUpdate nav (const (pure unit)) model message)
  where
  nav =
    { pushState: \_ _ -> pure unit
    , replaceState: \_ _ -> pure unit
    , locationState: pure { state: unsafeToForeign {}, path: "", pathname: "", search: "", hash: "" }
    , listen: \_ -> pure (pure unit)
    }

testRequestIsolation :: Effect Unit
testRequestIsolation = do
  let model = sampleModel { dataEpoch = 4, filesEpoch = 4 }
  assertEqual "stale folder request cannot overwrite current files"
    (update model (FilesLoaded 3 (Right []))).files
    model.files
  assertEqual "list request cannot replace dedicated detail state"
    (update (model { route = Just (FileDetail "f1") }) (FilesLoaded 4 (Right []))).detail
    model.detail
  let logout = update model LogoutDone
  assertEqual "logout erases protected data" logout.files NotAsked
  assertEqual "logout ignores earlier detail response"
    (update logout (DetailLoaded 4 (Right [ sampleFile ]))).detail
    NotAsked
  let saving = model { busy = true, files = Failed "network" }
  assertEqual "manual reload cannot invalidate a pending mutation" (update saving LoadDrive).dataEpoch saving.dataEpoch
  assertEqual "mutation can still settle after ignored reload"
    (update (update saving LoadDrive) (FolderSaved 4 (Right sampleFolder))).busy
    false

testQueueFolderIsolation :: Effect Unit
testQueueFolderIsolation = do
  let inFolder = sampleModel { selectedFolder = Just "fold1", route = Just (FolderDetail "fold1"), files = Loaded [] }
  assertEqual "completed root upload never enters another folder"
    (update inFolder (UploadCommitted sampleFile)).files
    (Loaded [])
  let root = sampleModel { files = Loaded [] }
  assertEqual "completed matching upload updates current folder"
    (update root (UploadCommitted sampleFile)).files
    (Loaded [ sampleFile ])
  let loading = sampleModel { files = Loading, filesEpoch = 9, dataEpoch = 4, busy = true }
  let saved = update loading (UploadCommitted sampleFile)
  assertEqual "upload supersedes any earlier list snapshot" saved.filesEpoch 10
  assertEqual "upload does not invalidate concurrent CRUD" saved.dataEpoch 4
  assertEqual "late pre-upload snapshot is ignored" (update saved (FilesLoaded 9 (Right []))).files Loading
  assertEqual "fresh post-upload list can settle" (update saved (FilesLoaded 10 (Right [ sampleFile ]))).files (Loaded [ sampleFile ])
  assertEqual "concurrent folder mutation still clears busy" (update saved (FolderSaved 4 (Right sampleFolder))).busy false

testHierarchy :: Effect Unit
testHierarchy = do
  let child = Folder { id: "child", name: "Nested", parentId: Just "fold1", createdAt: "2026-09-01" }
  assertEqual "root shows only direct folders" (visibleFolders sampleModel [ sampleFolder, child ]) [ sampleFolder ]
  assertEqual "nested folder contents are scoped" (visibleFolders (sampleModel { selectedFolder = Just "fold1" }) [ sampleFolder, child ]) [ child ]
  assertEqual "breadcrumb contains the complete parent chain" (folderAncestors [ sampleFolder, child ] (Just "child")) [ sampleFolder, child ]
  assertEqual "folder cannot leak root files" (visibleFiles (sampleModel { selectedFolder = Just "fold1" }) [ sampleFile ]) []
  assertEqual "view switch preserves filter" (update (sampleModel { search = "hello", sort = "size" }) (SetViewMode "grid")).search "hello"

testGrid :: Effect Unit
testGrid = do
  html <- render (View.view (sampleModel { viewMode = "grid", folderFormOpen = false }))
  assertEqual "grid links to file" (contains (Pattern "href=\"/drive/files/f1\"") html) true
  assertEqual "grid excludes item size" (contains (Pattern "123 B") html) false
  assertEqual "grid excludes item date" (contains (Pattern "2026-08-30") html) false
  assertEqual "list excludes location column" (contains (Pattern ">保存場所<") html) false

testFolderRenameId :: Effect Unit
testFolderRenameId = do
  html <- render (View.view (sampleModel { folderFormOpen = true, folderForm = { name: "New", editing: Just "fold1" } }))
  assertEqual "rename input uses stable folder id" (contains (Pattern "folder-rename-input-fold1") html) true
  assertEqual "rename save uses stable folder id" (contains (Pattern "folder-rename-save-fold1") html) true

testFileDetailLink :: Effect Unit
testFileDetailLink = do
  html <- render (View.view sampleModel)
  assertEqual "list links to dedicated file detail" (contains (Pattern "href=\"/drive/files/f1\"") html) true

testFileDetailLoaded :: Effect Unit
testFileDetailLoaded = do
  let model = (initialModel (Just (FileDetail "f1"))) { isHydrated = true, detail = Loading }
  let result = update model (DetailLoaded 0 (Right [ sampleFile ]))
  assertEqual "file result is accepted on detail route" result.detail (Loaded [ sampleFile ])

testFileDetailView :: Effect Unit
testFileDetailView = do
  let model = sampleModel { route = Just (FileDetail "f1"), page = Model.FileDetail "f1", detail = Loaded [ sampleFile ] }
  html <- render (View.view model)
  assertEqual "detail view renders selected file MIME type" (contains (Pattern "text/plain") html) true
  assertEqual "detail view is separate from list" (contains (Pattern "data-testid=\"file-detail-page\"") html) true

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual label actual expected =
  unless (actual == expected)
    (throw (label <> " — expected " <> show expected <> ", got " <> show actual))

roundTrip :: forall a. Eq a => Show a => EncodeJson a => DecodeJson a => String -> a -> Effect Unit
roundTrip label value = case hush (decodeJson (encodeJson value)) of
  Just decoded -> assertEqual label decoded value
  Nothing -> throw (label <> " — decode failed")

decodeBody :: forall a. DecodeJson a => String -> Maybe a
decodeBody s = hush (jsonParser s) >>= (hush <<< decodeJson)

testRouteCodec :: Effect Unit
testRouteCodec = do
  assertEqual "parse /login" (hush (parse routeCodec "/login")) (Just Login)
  assertEqual "parse /drive" (hush (parse routeCodec "/drive")) (Just Drive)
  assertEqual "file detail path" (hush (parse routeCodec "/drive/files/f1")) (Just (FileDetail "f1"))
  assertEqual "nested folder path" (hush (parse routeCodec "/drive/folders/fold1")) (Just (FolderDetail "fold1"))
  assertEqual "parse / is unknown" (hush (parse routeCodec "/")) Nothing
  assertEqual "parse unknown path" (hush (parse routeCodec "/nope")) Nothing
  assertEqual "folder route roundtrip" (hush (parse routeCodec (print routeCodec (FolderDetail "fold1")))) (Just (FolderDetail "fold1"))

sampleFile :: FileItem
sampleFile = FileItem
  { id: "f1"
  , name: "hello.txt"
  , mimeType: "text/plain"
  , sizeBytes: 123.0
  , folderId: Nothing
  , isPublic: false
  , createdAt: "2026-08-30T00:00:00Z"
  }

sampleFolder :: Folder
sampleFolder = Folder { id: "fold1", name: "Docs", parentId: Nothing, createdAt: "2026-08-30T00:00:00Z" }

sampleBilling :: Billing
sampleBilling = Billing { usedBytes: 2048.0, storageQuotaBytes: 10240.0, maxFileBytes: 1024.0, rateLimitRpm: 60 }

sampleModel :: Model
sampleModel = (initialModel (Just Drive))
  { isHydrated = true
  , session = Just { username: "alice" }
  , files = Loaded [ sampleFile ]
  , folders = Loaded [ sampleFolder ]
  , billing = Loaded sampleBilling
  , uploads = [ { id: "upload-1", name: "hello.txt", destinationId: "", destinationName: "マイドライブ", status: "sending", loaded: 50.0, total: 123.0, error: "", retryable: false } ]
  }

testModelRoundTrip :: Effect Unit
testModelRoundTrip = do
  roundTrip "initial model (unknown route)" (initialModel Nothing)
  roundTrip "initial model (login)" (initialModel (Just Login))
  roundTrip "initial model (drive)" (initialModel (Just Drive))
  roundTrip "initial model (folder)" (initialModel (Just (FolderDetail "fold1")))
  roundTrip "populated model" sampleModel

testRemoteDataRoundTrip :: Effect Unit
testRemoteDataRoundTrip = do
  roundTrip "RemoteData NotAsked" (NotAsked :: RemoteData (Array FileItem))
  roundTrip "RemoteData Loading" (Loading :: RemoteData (Array FileItem))
  roundTrip "RemoteData Failed" (Failed "oops" :: RemoteData (Array FileItem))
  roundTrip "RemoteData Loaded" (Loaded [ sampleFile ] :: RemoteData (Array FileItem))

testFileItemDecode :: Effect Unit
testFileItemDecode = do
  assertEqual "decode file (folderId null)" (decodeBody fileJsonNull) (Just sampleFile)
  assertEqual "decode file (folderId absent)" (decodeBody fileJsonAbsent) (Just sampleFile)
  where
  fileJsonNull = "{\"id\":\"f1\",\"name\":\"hello.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":123,\"folderId\":null,\"isPublic\":false,\"createdAt\":\"2026-08-30T00:00:00Z\"}"
  fileJsonAbsent = "{\"id\":\"f1\",\"name\":\"hello.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":123,\"isPublic\":false,\"createdAt\":\"2026-08-30T00:00:00Z\"}"

testBillingCamelCaseDecode :: Effect Unit
testBillingCamelCaseDecode = assertEqual "billing camelCase decode"
  (decodeBody "{\"usedBytes\":2048,\"storageQuotaBytes\":10240,\"maxFileBytes\":1024,\"rateLimitRpm\":60}")
  (Just sampleBilling)

testHumanize :: Effect Unit
testHumanize = do
  assertEqual "humanize 0 B" (humanize 0.0) "0 B"
  assertEqual "humanize 512 B" (humanize 512.0) "512 B"
  assertEqual "humanize 1.0 KiB" (humanize 1024.0) "1.0 KiB"
  assertEqual "humanize 100.0 MiB" (humanize 104857600.0) "100.0 MiB"

testUploadErrorMessage :: Effect Unit
testUploadErrorMessage = do
  assertEqual "payload_too_large mentions size limit"
    (mentionsSizeLimit (uploadErrorMessage (Just 104857600.0) "{\"error\":{\"code\":\"payload_too_large\"}}"))
    true
  assertEqual "insufficient_storage maps to storage message"
    (uploadErrorMessage (Just 1024.0) "{\"error\":{\"code\":\"insufficient_storage\"}}")
    "ストレージ容量が不足しています (size limit: 1.0 KiB total)"
