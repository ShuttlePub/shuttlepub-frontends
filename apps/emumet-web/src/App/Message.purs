module App.Message where

import Prelude (class Eq)

import App.Admin.Types (AdminMsg)
import App.Api.GraphQL.Types (AccountResponse, MetadataResponse, ProfileResponse)
import App.Model (AccountWithDetails, SessionInfo)
import App.Route (Route)
import App.Username (Verdict)
import Data.Maybe (Maybe)

-- | Which username input a check result belongs to.
data UsernameTarget = ForNewAccount | ForExistingProfile

derive instance Eq UsernameTarget

data Message
  = Navigate Route
  | UrlChanged (Maybe Route)
  -- Authentication (BFF-based)
  | CheckSession -- fire GET /auth/session on startup
  | SessionLoaded SessionInfo -- session cookie valid
  | SessionFailed -- no session from check (ignored if session already established)
  | SessionUnavailable -- the session check itself failed (5xx / network): not an answer about the session
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
  -- Instance host (the @host part of an acct)
  | InstanceHostLoaded String
  | InstanceHostFailed
  | RetryInstanceHost
  -- New account modal
  | SetNewAccountName String
  | SetNewAccountIsBot Boolean
  | SetNewAccountUsername String
  | ReviewNewAccount -- Create pressed: show the "cannot be changed" confirmation
  | BackNewAccount -- back from the confirmation to the inputs
  | CloseNewAccount -- cancel: back to the account list
  | SubmitNewAccount -- confirmed: create
  | AccountCreated Int AccountResponse -- generation
  | AccountCreateFailed Int String -- generation, errorMsg
  -- Username checks (debounced; stale results are ignored by comparing the value)
  | UsernameSettled UsernameTarget String -- typing paused: ask the server
  | RecheckUsername UsernameTarget -- "check again" after an unconfirmed answer
  | UsernameChecked UsernameTarget String Verdict
  | UsernameRejected UsernameTarget Int (Maybe String) String Verdict -- target, generation, accountId (set dialog), value, verdict
  -- One-time username setting for an existing profile
  | OpenSetUsername
  | CloseSetUsername
  | SetSetUsernameInput String
  | ReviewSetUsername
  | BackSetUsername
  | ConfirmSetUsername
  | UsernameSaved Int String ProfileResponse -- generation, accountId, profile
  | UsernameSaveFailed Int String String -- generation, accountId, errorMsg
  | UsernameAlreadySet Int String String -- generation, accountId, errorMsg (set elsewhere meanwhile: reload)
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
