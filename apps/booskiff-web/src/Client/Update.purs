module Client.Update where

import Prelude

import App.Api.Auth as Auth
import App.Api.Auth (LoginResponse(..), SessionResponse(..))
import App.Api.Drive as Drive
import App.Message (Message(..))
import App.Model (Billing(..), FileItem(..), Folder(..), Model, RemoteData(..), emptyFolderForm, emptyLoginForm, folderForRoute, initialModel, isDriveRoute, isProtectedRoute, pageForMaybeRoute)
import App.Route (Route(..), routeCodec)
import Client.Upload as Upload
import Data.Array (filter, find)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), isJust, isNothing, maybe)
import Data.String (Pattern(..), contains)
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

mkUpdate :: PushStateInterface -> (Message -> Effect Unit) -> Update Model Message
mkUpdate nav sendMessage model = case _ of
  Navigate route -> Tuple model [ liftEffect (nav.pushState (unsafeToForeign {}) (print routeCodec route)) $> Nothing ]
  UrlChanged mRoute ->
    if not model.isHydrated then noMessages $ model { isHydrated = true }
    else
      let
        needsAuth = maybe false isProtectedRoute mRoute && isNothing model.session
        effectiveRoute = if needsAuth then Just Login else mRoute
        epoch = model.dataEpoch + 1
        base = model
          { route = effectiveRoute
          , page = pageForMaybeRoute effectiveRoute
          , selectedFolder = folderForRoute effectiveRoute
          , folderForm = emptyFolderForm
          , folderFormOpen = false
          , errorMessage = Nothing
          , busy = false
          , dataEpoch = epoch
          , filesEpoch = model.filesEpoch + 1
          }
      in
        if needsAuth then Tuple base [ replace Login ]
        else if isDriveRoute mRoute then Tuple (base { files = Loading, folders = Loading }) [ pure $ Just LoadDrive ]
        else case mRoute of
          Just (FileDetail fileId) -> Tuple (base { detail = Loading }) [ loadFileDetailAff epoch fileId ]
          Just Login | isJust model.session -> Tuple base [ replace Drive ]
          Just Login -> noMessages $ base { loginForm = emptyLoginForm }
          _ -> noMessages base

  CheckSession -> Tuple model [ checkSessionAff ]
  SessionChecked mUsername -> case mUsername of
    Just username ->
      let
        m = model { session = Just { username }, busy = false }
        setup = liftEffect (Upload.initialize (sendMessage <<< UploadsChanged) (sendMessage <<< UploadCommitted)) $> Nothing
      in
        if isDriveRoute m.route then Tuple m [ setup, pure $ Just LoadDrive ]
        else case m.route of
          Just Login -> Tuple m [ setup, replace Drive ]
          Just (FileDetail fileId) -> Tuple (m { detail = Loading }) [ setup, loadFileDetailAff m.dataEpoch fileId ]
          _ -> Tuple m [ setup ]
    Nothing ->
      let
        needsAuth = maybe false isProtectedRoute model.route
        route = if needsAuth then Just Login else model.route
        m = (initialModel route)
          { isHydrated = true
          , dataEpoch = model.dataEpoch + 1
          , filesEpoch = model.filesEpoch + 1
          , billingEpoch = model.billingEpoch + 1
          , loginForm = if model.route == Just Login then model.loginForm else emptyLoginForm
          }
      in
        Tuple m [ liftEffect Upload.reset $> Nothing, if needsAuth then replace Login else pure Nothing ]
  LoginIdentifierChanged identifier -> noMessages $ model { loginForm = model.loginForm { identifier = identifier } }
  LoginPasswordChanged password -> noMessages $ model { loginForm = model.loginForm { password = password } }
  SubmitLogin ->
    let
      identifier = trim model.loginForm.identifier
    in
      if identifier == "" || model.loginForm.password == "" || model.busy then noMessages model
      else Tuple (model { errorMessage = Nothing, busy = true }) [ submitLoginAff identifier model.loginForm.password ]
  LoginFailed msg -> noMessages $ model { errorMessage = Just msg, busy = false }
  Logout -> Tuple model
    [ do
        allowed <- liftEffect Upload.confirmLogout
        pure $ if allowed then Just LogoutConfirmed else Nothing
    ]
  LogoutConfirmed -> Tuple (model { uploads = [], downloads = [], dataEpoch = model.dataEpoch + 1, filesEpoch = model.filesEpoch + 1, billingEpoch = model.billingEpoch + 1, busy = true })
    [ liftEffect Upload.reset *> logoutAff ]
  LogoutDone -> Tuple ((initialModel (Just Login)) { isHydrated = true, dataEpoch = model.dataEpoch + 1, filesEpoch = model.filesEpoch + 1, billingEpoch = model.billingEpoch + 1 }) [ replace Login ]
  LogoutFailed msg -> Tuple (model { errorMessage = Just ("ログアウトに失敗しました: " <> msg), busy = false })
    [ liftEffect (Upload.initialize (sendMessage <<< UploadsChanged) (sendMessage <<< UploadCommitted)) $> Nothing ]

  LoadDrive ->
    if not (isDriveRoute model.route) || isNothing model.session || model.busy then noMessages model
    else
      let
        epoch = model.dataEpoch + 1
        filesEpoch = model.filesEpoch + 1
        billingEpoch = model.billingEpoch + 1
      in
        Tuple (model { files = Loading, folders = Loading, dataEpoch = epoch, filesEpoch = filesEpoch, billingEpoch = billingEpoch })
          [ loadFilesAff filesEpoch model.selectedFolder, foldersAff epoch, billingAff billingEpoch ]
  FilesLoaded epoch result ->
    if epoch == model.filesEpoch && isDriveRoute model.route then noMessages $ model { files = remote result }
    else noMessages model
  DetailLoaded epoch result ->
    if epoch == model.dataEpoch then noMessages $ model { detail = remote result }
    else noMessages model
  FoldersLoaded epoch result ->
    if epoch == model.dataEpoch && isDriveRoute model.route then noMessages $ model { folders = remote result }
    else noMessages model
  BillingLoaded epoch result ->
    -- Capacity is shared across routes, but every fetch has its own generation:
    -- rapid uploads/deletions must not let an older snapshot replace the latest.
    if epoch /= model.billingEpoch || isNothing model.session then noMessages model
    else Tuple (model { billing = remote result })
      [ case result of
          Right (Billing b) -> liftEffect (Upload.configureLimit b.maxFileBytes) $> Nothing
          Left _ -> pure Nothing
      ]
  SelectFolder folder -> Tuple model [ pure $ Just $ Navigate (maybe Drive FolderDetail folder) ]
  SetViewMode mode -> noMessages $ model { viewMode = if mode == "grid" then "grid" else "list" }
  SearchChanged search -> noMessages $ model { search = search }
  SortChanged sort -> noMessages $ model { sort = sort }

  OpenCreateFolder -> noMessages $ model { folderFormOpen = true, folderForm = emptyFolderForm, errorMessage = Nothing }
  CloseFolderForm -> noMessages $ model { folderFormOpen = false, folderForm = emptyFolderForm }
  FolderNameChanged name -> noMessages $ model { folderForm = model.folderForm { name = name } }
  SubmitCreateFolder ->
    let
      name = trim model.folderForm.name
    in
      if name == "" || model.busy then noMessages model
      else Tuple (model { busy = true, errorMessage = Nothing })
        [ Just <<< FolderSaved model.dataEpoch <$> Drive.createFolder name model.selectedFolder ]
  StartRenameFolder id ->
    let
      name = case model.folders of
        Loaded folders -> maybe "" (\(Folder f) -> f.name) (find (\(Folder f) -> f.id == id) folders)
        _ -> ""
    in
      noMessages $ model { folderFormOpen = true, folderForm = { name, editing: Just id }, errorMessage = Nothing }
  SubmitRenameFolder -> case model.folderForm.editing of
    Just id | trim model.folderForm.name /= "" && not model.busy ->
      Tuple (model { busy = true, errorMessage = Nothing })
        [ Just <<< FolderSaved model.dataEpoch <$> Drive.renameFolder id (trim model.folderForm.name) ]
    _ -> noMessages model
  SubmitDeleteFolder id -> Tuple model [ confirmAff "空のフォルダを削除しますか？この操作は取り消せません。" (DeleteFolderConfirmed id) ]
  DeleteFolderConfirmed id ->
    if model.busy then noMessages model
    else Tuple (model { busy = true, errorMessage = Nothing })
      [ Just <<< FolderDeleted model.dataEpoch <<< map (const id) <$> Drive.deleteFolder id ]
  FolderSaved epoch result ->
    if epoch /= model.dataEpoch then noMessages model
    else case result of
      Right folder@(Folder fr) ->
        let
          folders = case model.folders of
            Loaded fs -> Loaded (filter (\(Folder f) -> f.id /= fr.id) fs <> [ folder ])
            st -> st
        in
          noMessages $ model { folders = folders, folderFormOpen = false, folderForm = emptyFolderForm, busy = false }
      Left err -> noMessages $ model { errorMessage = Just err, busy = false }
  FolderDeleted epoch result ->
    if epoch /= model.dataEpoch then noMessages model
    else case result of
      Right id -> noMessages $ model
        { folders = case model.folders of
            Loaded fs -> Loaded (filter (\(Folder f) -> f.id /= id) fs)
            st -> st
        , busy = false
        }
      Left err -> noMessages $ model
        { busy = false
        , errorMessage = Just
            ( if contains (Pattern "409") err || contains (Pattern "not empty") err || contains (Pattern "conflict") err then "中身があるフォルダは削除できません。ファイルと子フォルダを確認してください。"
              else err
            )
        }

  SubmitDeleteFile id -> Tuple model [ confirmAff "ファイルを削除しますか？この操作は取り消せません。" (DeleteFileConfirmed id) ]
  DeleteFileConfirmed id ->
    if model.busy then noMessages model
    else Tuple (model { busy = true, errorMessage = Nothing })
      [ Just <<< FileDeleted model.dataEpoch <<< map (const id) <$> Drive.deleteFile id ]
  FileDeleted epoch result ->
    if epoch /= model.dataEpoch then noMessages model
    else case result of
      Right id ->
        let
          billingEpoch = model.billingEpoch + 1
        in
          Tuple
            ( model
                { files = case model.files of
                    Loaded fs -> Loaded (filter (\(FileItem f) -> f.id /= id) fs)
                    st -> st
                , busy = false
                , billingEpoch = billingEpoch
                }
            )
            [ billingAff billingEpoch ]
      Left err -> noMessages $ model { errorMessage = Just err, busy = false }

  ChooseUpload -> Tuple model [ liftEffect Upload.chooseFiles $> Nothing ]
  StartUpload -> Tuple model [ liftEffect Upload.enqueueInput $> Nothing ]
  UploadsChanged uploads ->
    if isNothing model.session then noMessages model
    else noMessages $ model { uploads = uploads }
  UploadCommitted file@(FileItem f) ->
    if isNothing model.session then noMessages model
    else if isDriveRoute model.route && f.folderId == model.selectedFolder && model.files == Loading then
      -- The in-flight list may have been read before this save committed.
      -- Start a new generation so that older response cannot hide the new file.
      -- Keep CRUD's navigation epoch intact so its busy flag can settle.
      let
        filesEpoch = model.filesEpoch + 1
        billingEpoch = model.billingEpoch + 1
      in
        Tuple (model { filesEpoch = filesEpoch, billingEpoch = billingEpoch })
          [ loadFilesAff filesEpoch model.selectedFolder, billingAff billingEpoch ]
    else
      let
        billingEpoch = model.billingEpoch + 1
        files = case model.files of
          Loaded fs | isDriveRoute model.route && f.folderId == model.selectedFolder ->
            Loaded (filter (\(FileItem existing) -> existing.id /= f.id) fs <> [ file ])
          st -> st
      in
        Tuple (model { files = files, billingEpoch = billingEpoch }) [ billingAff billingEpoch ]
  RetryUpload id -> Tuple model [ liftEffect (Upload.retry id) $> Nothing ]
  DismissTransfer id -> Tuple model [ liftEffect (Upload.dismiss id) $> Nothing ]
  ToggleTransfers -> noMessages $ model { transferExpanded = not model.transferExpanded }
  ClearTransfers -> Tuple (model { downloads = [] }) [ liftEffect Upload.clearFinished $> Nothing ]
  DownloadRequested id name -> noMessages $ model
    { downloads = filter (\download -> download.id /= id) model.downloads <> [ { id, name } ] }
  DismissError -> noMessages $ model { errorMessage = Nothing }
  where
  replace route = liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec route)) $> Nothing

remote :: forall a. Either String a -> RemoteData a
remote = case _ of
  Right value -> Loaded value
  Left err -> Failed err

confirmAff :: String -> Message -> Aff (Maybe Message)
confirmAff prompt message = do
  allowed <- liftEffect $ Upload.confirmAction prompt
  pure $ if allowed then Just message else Nothing

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

loadFilesAff :: Int -> Maybe String -> Aff (Maybe Message)
loadFilesAff epoch folder = Just <<< FilesLoaded epoch <$> Drive.listFiles folder

loadFileDetailAff :: Int -> String -> Aff (Maybe Message)
loadFileDetailAff epoch id = Just <<< DetailLoaded epoch <$> Drive.fileDetail id

foldersAff :: Int -> Aff (Maybe Message)
foldersAff epoch = Just <<< FoldersLoaded epoch <$> Drive.listFolders

billingAff :: Int -> Aff (Maybe Message)
billingAff epoch = Just <<< BillingLoaded epoch <$> Drive.billingStatus
