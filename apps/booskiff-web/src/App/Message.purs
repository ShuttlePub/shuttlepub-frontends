module App.Message where

import App.Model (Billing, FileItem, Folder, UploadState)
import App.Route (Route)
import Data.Either (Either)
import Data.Maybe (Maybe)

data Message
  = Navigate Route
  | UrlChanged (Maybe Route)
  | CheckSession
  | SessionChecked (Maybe String)
  | LoginIdentifierChanged String
  | LoginPasswordChanged String
  | SubmitLogin
  | LoginFailed String
  | Logout
  | LogoutConfirmed
  | LogoutDone
  | LogoutFailed String
  | LoadDrive
  | FilesLoaded Int (Either String (Array FileItem))
  | DetailLoaded Int (Either String (Array FileItem))
  | FoldersLoaded Int (Either String (Array Folder))
  | BillingLoaded Int (Either String Billing)
  | SelectFolder (Maybe String)
  | SetViewMode String
  | SearchChanged String
  | SortChanged String
  | ToggleNewMenu
  | OpenCreateFolder
  | CloseFolderForm
  | FolderNameChanged String
  | SubmitCreateFolder
  | StartRenameFolder String
  | SubmitRenameFolder
  | SubmitDeleteFolder String
  | DeleteFolderConfirmed String
  | FolderSaved Int (Either String Folder)
  | FolderDeleted Int (Either String String)
  | SubmitDeleteFile String
  | DeleteFileConfirmed String
  | FileDeleted Int (Either String String)
  | ChooseUpload
  | StartUpload
  | UploadsChanged (Array UploadState)
  | UploadCommitted FileItem
  | RetryUpload String
  | DismissTransfer String
  | ToggleTransfers
  | ClearTransfers
  | DownloadRequested String String
  | DismissError
