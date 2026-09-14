-- allow: SIZE_OK — single Flame state machine mirroring emumet-web's
-- Client/Update.purs layout (one case branch per message, plus the Aff
-- helpers producing messages); splitting it would deviate from the
-- architecture template the Drive UX task builds on.
module Client.Update where

import Prelude

import App.Api.Auth as Auth
import App.Api.Drive as Drive
import App.Api.Auth (LoginResponse(..), SessionResponse(..))
import App.Format as Format
import App.Message (Message(..))
import App.Model (Billing(..), FileItem(..), Folder(..), Model, RemoteData(..), emptyFolderForm, emptyLoginForm, isProtectedRoute, pageForMaybeRoute)
import App.Route (Route(..), routeCodec)
import Client.Upload as Upload
import Data.Array (filter, find)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), isJust, isNothing, maybe)
import Data.String.Common (trim)
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Flame (Update, noMessages)
import Foreign (unsafeToForeign)
import Routing.Duplex (print)
import Routing.PushState (PushStateInterface)
import Web.HTML (window)
import Web.HTML.Location as Location
import Web.HTML.Window (location)

-- | File input the FFI upload flow reads from (see Client.Upload and the
-- | Drive view owned by the follow-up UX task).
uploadInputSelector :: String
uploadInputSelector = "[data-testid='upload-input']"

maxFileBytes :: RemoteData Billing -> Maybe Number
maxFileBytes = case _ of
  Loaded (Billing b) -> Just b.maxFileBytes
  _ -> Nothing

mkUpdate :: PushStateInterface -> (Message -> Effect Unit) -> Update Model Message
mkUpdate nav sendMessage model = case _ of
  Navigate route ->
    Tuple model
      [ liftEffect (nav.pushState (unsafeToForeign {}) (print routeCodec route)) $> Nothing ]

  UrlChanged mRoute ->
    if not model.isHydrated then noMessages $ model { isHydrated = true }
    else
      let
        -- Redirect to login when navigating to a protected route while
        -- unauthenticated (the initial hydration call is exempt: the server
        -- cannot know the session, so CheckSession decides below).
        needsAuth = case mRoute of
          Just r -> isProtectedRoute r && isNothing model.session
          Nothing -> false
        effectiveRoute = if needsAuth then Just Login else mRoute
        base = model
          { route = effectiveRoute
          , page = pageForMaybeRoute effectiveRoute
          , folderForm = emptyFolderForm
          , errorMessage = Nothing
          , busy = false
          }
      in
        if needsAuth then
          Tuple base
            [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
        else case mRoute of
          Just Drive ->
            Tuple base [ pure $ Just LoadDrive ]
          Just (FileDetail fileId) ->
            Tuple (base { files = Loading }) [ loadFileDetailAff fileId ]
          Just Login ->
            -- Redirect authenticated users away from the login page
            if isJust model.session then
              Tuple (base { route = Just Drive, page = pageForMaybeRoute (Just Drive) })
                [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Drive)) $> Nothing ]
            else
              noMessages $ base { loginForm = emptyLoginForm }
          _ -> noMessages base

  -- Authentication (BFF-based)
  CheckSession ->
    Tuple model [ checkSessionAff ]

  SessionChecked mUsername ->
    case mUsername of
      Just username ->
        let
          m = model { session = Just { username }, busy = false }
        in
          case m.route of
            Just Login ->
              -- Authenticated user on the login page → Drive
              Tuple m
                [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Drive)) $> Nothing ]
            Just Drive ->
              -- Session established after hydration → load drive data now
              Tuple m [ pure $ Just LoadDrive ]
            Just (FileDetail fileId) ->
              Tuple (m { files = Loading }) [ loadFileDetailAff fileId ]
            _ -> noMessages m
      Nothing ->
        let
          m = model { session = Nothing, busy = false }
        in
          case m.route of
            Just r | isProtectedRoute r ->
              -- Unauthenticated on a protected route → login
              Tuple
                (m { route = Just Login, page = pageForMaybeRoute (Just Login), loginForm = emptyLoginForm })
                [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
            _ -> noMessages m

  LoginIdentifierChanged identifier ->
    noMessages $ model { loginForm = model.loginForm { identifier = identifier } }

  LoginPasswordChanged password ->
    noMessages $ model { loginForm = model.loginForm { password = password } }

  SubmitLogin ->
    let
      form = model.loginForm
      identifier = trim form.identifier
    in
      if identifier == "" || form.password == "" || model.busy then noMessages model
      else
        Tuple (model { errorMessage = Nothing, busy = true })
          [ submitLoginAff identifier form.password ]

  LoginFailed msg ->
    if model.route == Just Login then noMessages $ model { errorMessage = Just msg, busy = false }
    else noMessages $ model { busy = false }

  Logout ->
    Tuple model [ logoutAff ]

  LogoutDone ->
    Tuple
      ( model
          { session = Nothing
          , loginForm = emptyLoginForm
          , route = Just Login
          , page = pageForMaybeRoute (Just Login)
          }
      )
      [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]

  LogoutFailed msg ->
    noMessages $ model { errorMessage = Just ("Logout failed: " <> msg), busy = false }

  -- Drive data
  LoadDrive ->
    Tuple (model { files = Loading, folders = Loading, billing = Loading })
      [ loadFilesAff model.selectedFolder, foldersAff, billingAff ]

  FilesLoaded result ->
    if maybe false isProtectedRoute model.route then noMessages $ case result of
      Right files -> model { files = Loaded files }
      Left err -> model { files = Failed err, errorMessage = Just err }
    else noMessages model

  FoldersLoaded result ->
    if model.route == Just Drive then noMessages $ case result of
      Right folders -> model { folders = Loaded folders }
      Left err -> model { folders = Failed err, errorMessage = Just err }
    else noMessages model

  BillingLoaded result ->
    if model.route == Just Drive then noMessages $ case result of
      Right billing -> model { billing = Loaded billing }
      Left err -> model { billing = Failed err, errorMessage = Just err }
    else noMessages model

  SelectFolder mFolderId ->
    Tuple (model { selectedFolder = mFolderId, files = Loading })
      [ loadFilesAff mFolderId ]

  -- Folder operations
  FolderNameChanged name ->
    noMessages $ model { folderForm = model.folderForm { name = name } }

  SubmitCreateFolder ->
    let
      name = trim model.folderForm.name
    in
      if name == "" || model.busy then noMessages model
      else
        Tuple (model { errorMessage = Nothing, busy = true })
          [ createFolderAff name ]

  StartRenameFolder folderId ->
    let
      form = case model.folders of
        Loaded folders | Just (Folder folder) <- find (\(Folder f) -> f.id == folderId) folders ->
          { name: folder.name, editing: Just folderId }
        _ -> { name: "", editing: Just folderId }
    in
      noMessages $ model { folderForm = form, errorMessage = Nothing }

  SubmitRenameFolder ->
    case model.folderForm.editing of
      Nothing -> noMessages model
      Just folderId ->
        let
          name = trim model.folderForm.name
        in
          if name == "" || model.busy then noMessages model
          else
            Tuple (model { errorMessage = Nothing, busy = true })
              [ renameFolderAff folderId name ]

  SubmitDeleteFolder folderId ->
    if model.busy then noMessages model
    else
      Tuple (model { errorMessage = Nothing, busy = true })
        [ deleteFolderAff folderId ]

  FolderSaved result ->
    if model.route == Just Drive then case result of
      Right folder@(Folder fr) ->
        let
          wasRenaming = isJust model.folderForm.editing
          folders = case model.folders of
            Loaded fs -> Loaded
              ( if wasRenaming then
                  map (\f@(Folder fr2) -> if fr2.id == fr.id then folder else f) fs
                else
                  fs <> [ folder ]
              )
            st -> st
        in
          noMessages $ model { folders = folders, folderForm = emptyFolderForm, busy = false }
      Left err -> noMessages $ model { errorMessage = Just err, busy = false }
    else noMessages $ model { busy = false }

  FolderDeleted result ->
    if model.route == Just Drive then case result of
      Right folderId ->
        let
          folders = case model.folders of
            Loaded fs -> Loaded (filter (\(Folder f) -> f.id /= folderId) fs)
            st -> st
          mSelected = if model.selectedFolder == Just folderId then Nothing else model.selectedFolder
          m = model { folders = folders, selectedFolder = mSelected, busy = false }
        in
          -- Files of the deleted folder may be gone or reassigned: refetch.
          Tuple (m { files = Loading }) [ loadFilesAff mSelected ]
      Left err -> noMessages $ model { errorMessage = Just err, busy = false }
    else noMessages $ model { busy = false }

  -- File operations
  SubmitDeleteFile fileId ->
    if model.busy then noMessages model
    else
      Tuple (model { errorMessage = Nothing, busy = true })
        [ deleteFileAff fileId ]

  FileDeleted result ->
    if model.route == Just Drive then case result of
      Right fileId ->
        let
          files = case model.files of
            Loaded fs -> Loaded (filter (\(FileItem f) -> f.id /= fileId) fs)
            st -> st
        in
          -- Quota usage changed: refetch billing.
          Tuple (model { files = files, busy = false }) [ billingAff ]
      Left err -> noMessages $ model { errorMessage = Just err, busy = false }
    else noMessages $ model { busy = false }

  -- Upload (FFI-driven)
  StartUpload ->
    if model.busy then noMessages model
    else
      Tuple (model { upload = Just { name: "", loaded: 0.0, total: 0.0 }, errorMessage = Nothing, busy = true })
        [ uploadAff sendMessage ]

  UploadProgress p ->
    noMessages $ model { upload = map (\u -> u { loaded = p.loaded, total = p.total }) model.upload }

  UploadFinished result ->
    if model.route == Just Drive then
      let
        m = model { upload = Nothing, busy = false }
      in
        case result of
          Right file ->
            let
              files = case model.files of
                Loaded fs -> Loaded (fs <> [ file ])
                st -> st
            in
              Tuple (m { files = files }) [ billingAff ]
          Left err -> noMessages $ m { errorMessage = Just (Format.uploadErrorMessage (maxFileBytes model.billing) err) }
    else noMessages $ model { upload = Nothing, busy = false }

  -- Common
  DismissError ->
    noMessages $ model { errorMessage = Nothing }

-- Aff helpers: API calls that produce Messages

checkSessionAff :: Aff (Maybe Message)
checkSessionAff = do
  result <- Auth.session
  pure $ Just $ case result of
    Right (SessionResponse r) | r.authenticated -> SessionChecked (Just r.username)
    _ -> SessionChecked Nothing

submitLoginAff :: String -> String -> Aff (Maybe Message)
submitLoginAff identifier password = do
  result <- Auth.login { identifier, password }
  case result of
    Right (LoginResponse r) | r.authenticated -> case r.next of
      Just url -> do
        -- Real mode hands off to /auth/oauth/start via full-page navigation:
        -- XHR cannot drive the cross-origin Hydra redirect chain.
        liftEffect (window >>= location >>= Location.assign url)
        pure Nothing
      Nothing -> pure $ Just $ SessionChecked (Just r.username)
    Right _ -> pure $ Just $ LoginFailed "Login failed: invalid credentials"
    Left err -> pure $ Just $ LoginFailed err

logoutAff :: Aff (Maybe Message)
logoutAff = do
  result <- Auth.logout
  pure $ Just $ case result of
    Right _ -> LogoutDone
    Left err -> LogoutFailed err

loadFilesAff :: Maybe String -> Aff (Maybe Message)
loadFilesAff mFolderId = do
  result <- Drive.listFiles mFolderId
  pure $ Just $ FilesLoaded result

loadFileDetailAff :: String -> Aff (Maybe Message)
loadFileDetailAff fileId = do
  result <- Drive.fileDetail fileId
  pure $ Just $ FilesLoaded result

foldersAff :: Aff (Maybe Message)
foldersAff = do
  result <- Drive.listFolders
  pure $ Just $ FoldersLoaded result

billingAff :: Aff (Maybe Message)
billingAff = do
  result <- Drive.billingStatus
  pure $ Just $ BillingLoaded result

createFolderAff :: String -> Aff (Maybe Message)
createFolderAff name = do
  result <- Drive.createFolder name
  pure $ Just $ FolderSaved result

renameFolderAff :: String -> String -> Aff (Maybe Message)
renameFolderAff folderId name = do
  result <- Drive.renameFolder folderId name
  pure $ Just $ FolderSaved result

deleteFolderAff :: String -> Aff (Maybe Message)
deleteFolderAff folderId = do
  result <- Drive.deleteFolder folderId
  pure $ Just $ FolderDeleted (const folderId <$> result)

deleteFileAff :: String -> Aff (Maybe Message)
deleteFileAff fileId = do
  result <- Drive.deleteFile fileId
  pure $ Just $ FileDeleted (const fileId <$> result)

uploadAff :: (Message -> Effect Unit) -> Aff (Maybe Message)
uploadAff sendMessage = do
  result <- Upload.uploadFile uploadInputSelector (\p -> sendMessage (UploadProgress p))
  pure $ Just $ UploadFinished result
