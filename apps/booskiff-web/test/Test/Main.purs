module Test.Main where

import Prelude

import App.Format (humanize, mentionsSizeLimit, uploadErrorMessage)
import App.Model (Billing(..), FileItem(..), Folder(..), Model, RemoteData(..), initialModel)
import App.Route (Route(..), routeCodec)
import App.Model as Model
import App.Message (Message(..))
import App.View as View
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

testFileDetailLink :: Effect Unit
testFileDetailLink = do
  html <- render (View.view sampleModel)
  assertEqual "list links to dedicated file detail" (contains (Pattern "href=\"/drive/files/f1\"") html) true

testFileDetailLoaded :: Effect Unit
testFileDetailLoaded = do
  let
    nav =
      { pushState: \_ _ -> pure unit
      , replaceState: \_ _ -> pure unit
      , locationState: pure { state: unsafeToForeign {}, path: "", pathname: "", search: "", hash: "" }
      , listen: \_ -> pure (pure unit)
      }
  let model = (initialModel (Just (FileDetail "f1"))) { isHydrated = true, files = Loading }
  let result = fst (mkUpdate nav (const (pure unit)) model (FilesLoaded (Right [ sampleFile ])))
  assertEqual "file result is accepted on detail route" result.files (Loaded [ sampleFile ])

testFileDetailView :: Effect Unit
testFileDetailView = do
  let model = sampleModel { route = Just (FileDetail "f1"), page = Model.FileDetail "f1" }
  html <- render (View.view model)
  assertEqual "detail view renders selected file MIME type" (contains (Pattern "text/plain") html) true
  assertEqual "detail view is separate from list" (contains (Pattern "data-testid=\"file-detail-page\"") html) true

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual label actual expected =
  unless (actual == expected)
    (throw (label <> " — expected " <> show expected <> ", got " <> show actual))

-- | encode ∘ decode must be the identity.
roundTrip :: forall a. Eq a => Show a => EncodeJson a => DecodeJson a => String -> a -> Effect Unit
roundTrip label value = case hush (decodeJson (encodeJson value)) of
  Just decoded -> assertEqual label decoded value
  Nothing -> throw (label <> " — decode failed")

-- | Parse a JSON string and decode it, discarding error details.
decodeBody :: forall a. DecodeJson a => String -> Maybe a
decodeBody s = hush (jsonParser s) >>= (hush <<< decodeJson)

testRouteCodec :: Effect Unit
testRouteCodec = do
  assertEqual "parse /login" (hush (parse routeCodec "/login")) (Just Login)
  assertEqual "parse /drive" (hush (parse routeCodec "/drive")) (Just Drive)
  assertEqual "file detail path resolves when id exists in URL"
    (map show (hush (parse routeCodec "/drive/files/f1")))
    (Just "(FileDetail \"f1\")")
  assertEqual "parse / is unknown" (hush (parse routeCodec "/")) Nothing
  assertEqual "parse unknown path" (hush (parse routeCodec "/nope")) Nothing
  assertEqual "print Login" (print routeCodec Login) "/login"
  assertEqual "print Drive" (print routeCodec Drive) "/drive"
  assertEqual "round-trip Login" (hush (parse routeCodec (print routeCodec Login))) (Just Login)
  assertEqual "round-trip Drive" (hush (parse routeCodec (print routeCodec Drive))) (Just Drive)

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
sampleFolder = Folder { id: "fold1", name: "Docs", createdAt: "2026-08-30T00:00:00Z" }

sampleBilling :: Billing
sampleBilling = Billing
  { usedBytes: 2048.0
  , storageQuotaBytes: 10240.0
  , maxFileBytes: 1024.0
  , rateLimitRpm: 60
  }

sampleModel :: Model
sampleModel = (initialModel (Just Drive))
  { isHydrated = true
  , session = Just { username: "alice" }
  , files = Loaded [ sampleFile ]
  , folders = Loaded [ sampleFolder ]
  , billing = Loaded sampleBilling
  , upload = Just { name: "hello.txt", loaded: 50.0, total: 123.0 }
  , selectedFolder = Just "fold1"
  , folderForm = { name: "New", editing: Just "fold1" }
  , errorMessage = Just "boom"
  , busy = true
  }

testModelRoundTrip :: Effect Unit
testModelRoundTrip = do
  roundTrip "initial model (unknown route)" (initialModel Nothing)
  roundTrip "initial model (login)" (initialModel (Just Login))
  roundTrip "initial model (drive)" (initialModel (Just Drive))
  roundTrip "populated model" sampleModel

testRemoteDataRoundTrip :: Effect Unit
testRemoteDataRoundTrip = do
  roundTrip "RemoteData NotAsked" (NotAsked :: RemoteData (Array FileItem))
  roundTrip "RemoteData Loading" (Loading :: RemoteData (Array FileItem))
  roundTrip "RemoteData Failed" (Failed "oops" :: RemoteData (Array FileItem))
  roundTrip "RemoteData Loaded" (Loaded [ sampleFile ] :: RemoteData (Array FileItem))

testFileItemDecode :: Effect Unit
testFileItemDecode = do
  assertEqual "decode file (folderId null)"
    (decodeBody fileJsonNull)
    (Just sampleFile)
  assertEqual "decode file (folderId absent)"
    (decodeBody fileJsonAbsent)
    (Just sampleFile)
  where
  fileJsonNull =
    "{\"id\":\"f1\",\"name\":\"hello.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":123,\"folderId\":null,\"isPublic\":false,\"createdAt\":\"2026-08-30T00:00:00Z\"}"

  fileJsonAbsent =
    "{\"id\":\"f1\",\"name\":\"hello.txt\",\"mimeType\":\"text/plain\",\"sizeBytes\":123,\"isPublic\":false,\"createdAt\":\"2026-08-30T00:00:00Z\"}"

-- | The camelCase decode used by App.Api.Drive for GET /api/billing.
testBillingCamelCaseDecode :: Effect Unit
testBillingCamelCaseDecode =
  assertEqual "billing camelCase decode"
    (decodeBody billingJson)
    (Just sampleBilling)
  where
  billingJson =
    "{\"usedBytes\":2048,\"storageQuotaBytes\":10240,\"maxFileBytes\":1024,\"rateLimitRpm\":60}"

testHumanize :: Effect Unit
testHumanize = do
  assertEqual "humanize 0 B" (humanize 0.0) "0 B"
  assertEqual "humanize 512 B" (humanize 512.0) "512 B"
  assertEqual "humanize 1.0 KiB" (humanize 1024.0) "1.0 KiB"
  assertEqual "humanize 100.0 MiB" (humanize 104857600.0) "100.0 MiB"

testUploadErrorMessage :: Effect Unit
testUploadErrorMessage = do
  let
    sizeMsg = uploadErrorMessage (Just (100.0 * 1024.0 * 1024.0))
      "{\"error\":{\"code\":\"payload_too_large\",\"message\":\"too big\"}}"
  assertEqual "payload_too_large mentions size limit" (mentionsSizeLimit sizeMsg) true
  assertEqual "insufficient_storage maps to storage message"
    (uploadErrorMessage (Just 1024.0) "{\"error\":{\"code\":\"insufficient_storage\"}}")
    "ストレージ容量が不足しています (size limit: 1.0 KiB total)"
  assertEqual "unauthorized maps to login message"
    (uploadErrorMessage Nothing "{\"error\":{\"code\":\"unauthorized\"}}")
    "認証が必要です。再度ログインしてください。"
