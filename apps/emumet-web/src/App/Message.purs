module App.Message where

import App.Admin.Types (AdminMsg)
import App.Api.GraphQL.Types (AccountResponse, MetadataResponse, ProfileResponse)
import App.Model (AccountWithDetails, SessionInfo)
import App.Route (Route)
import Data.Maybe (Maybe)

data Message
  = Navigate Route
  | UrlChanged (Maybe Route)
  -- Authentication (BFF-based)
  | CheckSession -- fire GET /auth/session on startup
  | SessionLoaded SessionInfo -- session cookie valid
  | SessionFailed -- no session from check (ignored if session already established)
  | SessionExpired -- API returned 401 (force re-login regardless of local state)
  | SetLoginIdentifier String
  | SetLoginPassword String
  | SubmitLogin
  | LoginSuccess String -- username (cookie set by BFF, no token in client)
  | LoginFailed String
  | Logout
  | LogoutDone
  | LogoutFailed String
  -- Account list
  | FetchAccounts
  | AccountsLoaded (Array AccountResponse)
  | AccountsFailed String
  -- Account detail (account + profile + metadata via one GraphQL query)
  | FetchAccountDetail String
  | AccountDetailLoaded String AccountWithDetails
  | AccountDetailFailed String String
  -- New account form
  | SetNewAccountName String
  | SetNewAccountIsBot Boolean
  | SubmitNewAccount
  | AccountCreated AccountResponse
  | AccountCreateFailed String
  -- Profile editing
  | StartEditProfile
  | SetEditProfileDisplayName String
  | SetEditProfileSummary String
  | SetEditProfileIconUrl String
  | SetEditProfileBannerUrl String
  | SaveProfile
  | ProfileSaved Int String ProfileResponse -- generation, accountId, profile
  | ProfileSaveFailed Int String String -- generation, accountId, errorMsg
  | CancelEditProfile
  -- Metadata editing
  | StartAddMetadata
  | StartEditMetadata String
  | SetMetadataLabel String
  | SetMetadataContent String
  | SaveMetadata
  | MetadataSaved Int String MetadataResponse -- generation, accountId, metadata
  | MetadataSaveFailed Int String String -- generation, accountId, errorMsg
  | CancelMetadata
  | DeleteMetadata String
  | MetadataDeleted Int String String -- generation, accountId, nanoid
  | MetadataDeleteFailed Int String String -- generation, accountId, errorMsg
  -- Registration gate admin (D15)
  | Admin AdminMsg
