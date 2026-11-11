module Client.Update where

import Prelude

import App.Api.Client (ApiError(..), printApiError)
import App.Api.Auth as Auth
import App.Api.Auth (LoginRequest(..), LoginResponse(..), SessionResponse(..))
import App.Api.GraphQL as GraphQL
import App.Api.GraphQL.Types (AccountResponse(..), MetadataResponse(..), ProfileResponse(..), Tristate(..))
import App.Message (Message(..), UsernameTarget(..))
import App.Model (AccountWithDetails, DialogStep(..), Model, RemoteData(..), emptyLoginForm, emptyNewAccountForm, emptySetUsernameDialog, isProtectedRoute, pageForMaybeRoute)
import App.Route (Route(..), routeCodec)
import App.Username (Reason(..), Verdict(..), isAvailable, shouldAskServer)
import Data.Array (filter, find)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), fromMaybe, isJust, isNothing)
import Data.String.Common (trim)
import Data.Time.Duration (Milliseconds(..))
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff, delay)
import Effect.Class (liftEffect)
import Flame (Update, noMessages)
import Foreign (unsafeToForeign)
import Routing.Duplex (print)
import Client.Navigation (_navigateToUrl)
import Routing.PushState (PushStateInterface)

-- | Get the current account ID from selectedAccount, if loaded
currentAccountId :: Model -> Maybe String
currentAccountId model = case model.selectedAccount of
  Loaded d -> let AccountResponse acc = d.account in Just acc.id
  _ -> Nothing

mkUpdate :: PushStateInterface -> Update Model Message
mkUpdate nav model = case _ of
  Navigate route ->
    let
      url = print routeCodec route
    in
      Tuple model
        [ liftEffect (nav.pushState (unsafeToForeign {}) url) $> Nothing ]

  UrlChanged mRoute ->
    if not model.isHydrated then noMessages $ model { isHydrated = true }
    else
      let
        -- Redirect to login if accessing protected route while unauthenticated
        needsAuth = case mRoute of
          Just r -> isProtectedRoute r && isNothing model.session
          Nothing -> false
        effectiveRoute = if needsAuth then Just Login else mRoute
        base = model { route = effectiveRoute, page = pageForMaybeRoute effectiveRoute, editProfileForm = Nothing, editMetadataForm = Nothing, setUsernameDialog = Nothing, errorMessage = Nothing, savePending = false, saveGeneration = model.saveGeneration + 1 }
      in
        if needsAuth then
          Tuple base
            [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
        else
          case mRoute of
            Just Home ->
              Tuple (markHost (base { accounts = Loading })) (withHost model [ pure $ Just FetchAccounts ])
            Just (AccountDetail id) ->
              Tuple (markHost (base { selectedAccount = Loading })) (withHost model [ pure $ Just (FetchAccountDetail id) ])
            Just AccountNew ->
              -- The create modal opens over the account list
              Tuple (markHost (base { newAccountForm = emptyNewAccountForm, accounts = Loading })) (withHost model [ pure $ Just FetchAccounts ])
            Just Login ->
              -- Redirect authenticated user away from login page
              if isJust model.session then
                let
                  homeBase = model { route = Just Home, page = pageForMaybeRoute (Just Home), editProfileForm = Nothing, editMetadataForm = Nothing, errorMessage = Nothing, savePending = false, accounts = Loading }
                in
                  Tuple homeBase
                    [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Home)) $> Nothing
                    , pure $ Just FetchAccounts
                    ]
              else
                noMessages $ base { loginForm = emptyLoginForm }
            _ -> noMessages base

  -- Authentication (BFF-based)
  CheckSession ->
    Tuple model [ checkSessionAff ]

  SessionLoaded sessionInfo ->
    let
      m = model { session = Just sessionInfo }
    in
      case m.route of
        Just r | isProtectedRoute r ->
          -- Authenticated, dispatch page-specific init
          case m.route of
            Just Home ->
              Tuple (markHost (m { accounts = Loading })) (withHost m [ pure $ Just FetchAccounts ])
            Just (AccountDetail id) ->
              Tuple (markHost (m { selectedAccount = Loading })) (withHost m [ pure $ Just (FetchAccountDetail id) ])
            Just AccountNew ->
              Tuple (markHost (m { newAccountForm = emptyNewAccountForm, accounts = Loading })) (withHost m [ pure $ Just FetchAccounts ])
            _ -> noMessages m
        Just Login ->
          -- Authenticated user on login page → redirect to Home
          let
            homeModel = m { route = Just Home, page = pageForMaybeRoute (Just Home), accounts = Loading }
          in
            Tuple homeModel
              [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Home)) $> Nothing
              , pure $ Just FetchAccounts
              ]
        _ -> noMessages m

  SessionFailed ->
    -- Ignore stale SessionFailed if we already have an active session
    -- (e.g., startup CheckSession returns after successful LoginSuccess)
    if isJust model.session then noMessages model
    else
      let
        m = model { session = Nothing, savePending = false, editProfileForm = Nothing, editMetadataForm = Nothing }
      in
        case m.route of
          Just r | isProtectedRoute r ->
            Tuple (m { route = Just Login, page = pageForMaybeRoute (Just Login), loginForm = emptyLoginForm, errorMessage = Nothing })
              [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
          _ -> noMessages m

  SessionExpired ->
    -- API returned 401 — force re-login regardless of local session state
    let
      m = model { session = Nothing, savePending = false, editProfileForm = Nothing, editMetadataForm = Nothing }
    in
      case m.route of
        Just r | isProtectedRoute r ->
          Tuple (m { route = Just Login, page = pageForMaybeRoute (Just Login), loginForm = emptyLoginForm, errorMessage = Nothing })
            [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
        _ -> noMessages m

  SetLoginIdentifier identifier ->
    noMessages $ model { loginForm = model.loginForm { identifier = identifier } }

  SetLoginPassword password ->
    noMessages $ model { loginForm = model.loginForm { password = password } }

  SubmitLogin ->
    let
      form = model.loginForm
      trimmedIdentifier = trim form.identifier
    in
      if trimmedIdentifier == "" || form.password == "" || model.savePending then noMessages model
      else
        Tuple (model { errorMessage = Nothing, savePending = true })
          [ submitLoginAff trimmedIdentifier form.password ]

  LoginSuccess _username ->
    -- BFF has set the session cookie via /auth/login.
    -- Navigate to /auth/oauth/start which will:
    --   - Mock mode: 302 back to return_to (/) — session cookie already set
    --   - Real mode: redirect to Hydra OAuth2 flow → callback → session cookie → return_to
    -- Full page reload will trigger CheckSession to establish local session state.
    if model.route == Just Login then
      Tuple (model { loginForm = emptyLoginForm, errorMessage = Nothing, savePending = false })
        [ liftEffect (_navigateToUrl "/auth/oauth/start?return_to=/") $> Nothing ]
    else noMessages $ model { savePending = false }

  LoginFailed msg ->
    if model.route == Just Login then noMessages $ model { errorMessage = Just msg, savePending = false }
    else noMessages $ model { savePending = false }

  Logout ->
    Tuple model [ logoutAff ]

  LogoutDone ->
    Tuple (model { session = Nothing, loginForm = emptyLoginForm, route = Just Login, page = pageForMaybeRoute (Just Login) })
      [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]

  LogoutFailed msg ->
    noMessages $ model { errorMessage = Just ("Logout failed: " <> msg) }

  -- Account list: fetch from API
  FetchAccounts ->
    Tuple (model { accounts = Loading })
      [ fetchAccountsAff ]

  AccountsLoaded accs ->
    if model.route == Just Home || model.route == Just AccountNew then noMessages $ model { accounts = Loaded accs }
    else noMessages model

  AccountsFailed msg ->
    if model.route == Just Home || model.route == Just AccountNew then noMessages $ model { accounts = Failed, errorMessage = Just msg }
    else noMessages model

  -- Account detail: fetch account + profile + metadata (single GraphQL query)
  FetchAccountDetail id ->
    Tuple (model { selectedAccount = Loading })
      [ fetchAccountDetailAff id ]

  AccountDetailLoaded id detail ->
    if model.route == Just (AccountDetail id) then noMessages $ model { selectedAccount = Loaded detail }
    else noMessages model

  AccountDetailFailed id msg ->
    if model.route == Just (AccountDetail id) then noMessages $ model { selectedAccount = Failed, errorMessage = Just msg }
    else noMessages model

  -- Instance host (the @host part of an acct). Until it is known nothing can be confirmed.
  InstanceHostLoaded host ->
    noMessages $ model { instanceHost = Loaded host }

  InstanceHostFailed ->
    noMessages $ model { instanceHost = Failed }

  RetryInstanceHost ->
    if needsHost model then Tuple (markHost model) [ fetchInstanceHostAff ]
    else noMessages model

  -- New account modal
  SetNewAccountName name ->
    noMessages $ model { newAccountForm = model.newAccountForm { name = name } }

  SetNewAccountIsBot isBot ->
    noMessages $ model { newAccountForm = model.newAccountForm { isBot = isBot } }

  SetNewAccountUsername value ->
    -- No trimming or case folding: what is typed is what is checked and sent.
    Tuple (model { newAccountForm = model.newAccountForm { username = { value, verdict: Unverified }, step = StepInput } })
      (settleCommands ForNewAccount value)

  ReviewNewAccount ->
    let
      form = model.newAccountForm
    in
      if trim form.name /= "" && isAvailable form.username.value form.username.verdict && hostLoaded model && not model.savePending then
        noMessages $ model { newAccountForm = form { step = StepConfirm }, errorMessage = Nothing }
      else noMessages model

  BackNewAccount ->
    if model.savePending then noMessages model
    else noMessages $ model { newAccountForm = model.newAccountForm { step = StepInput }, errorMessage = Nothing }

  CloseNewAccount ->
    if model.savePending then noMessages model
    else
      Tuple (model { newAccountForm = emptyNewAccountForm, errorMessage = Nothing })
        [ liftEffect (nav.pushState (unsafeToForeign {}) (print routeCodec Home)) $> Nothing ]

  UsernameSettled target value ->
    if currentUsername model target == Just value && shouldAskServer value then
      Tuple model [ checkUsernameAff target value ]
    else noMessages model

  UsernameChecked target value verdict ->
    -- A late answer must not change the verdict under an open confirmation or a request in flight.
    if usernameLocked model target || usernameTaken model target value then noMessages model
    else noMessages $ withVerdict target value verdict model

  UsernameRejected target gen owner value verdict ->
    -- Apply only to the operation that is still current: same generation, same page/dialog,
    -- same account and the same typed value. A late answer for anything else changes nothing
    -- (and does not touch the pending flag of a newer operation).
    if gen == model.saveGeneration && usernameOwner model target == owner && currentUsername model target == Just value then
      noMessages $ (withVerdict target value verdict model) { savePending = false }
    else noMessages model

  SubmitNewAccount ->
    let
      form = model.newAccountForm
      trimmedName = trim form.name
      newGen = model.saveGeneration + 1
    in
      if trimmedName == "" || model.savePending || not (isAvailable form.username.value form.username.verdict) || not (hostLoaded model) then noMessages model
      else
        Tuple (model { errorMessage = Nothing, savePending = true, saveGeneration = newGen })
          [ submitNewAccountAff newGen trimmedName form.isBot form.username.value ]

  AccountCreated gen (AccountResponse acc) ->
    -- Guard: only the current create operation, and only while still on the AccountNew page
    if gen /= model.saveGeneration then noMessages model
    else if model.route == Just AccountNew then
      let
        url = print routeCodec (AccountDetail acc.id)
      in
        Tuple (model { newAccountForm = emptyNewAccountForm, errorMessage = Nothing, savePending = false })
          [ liftEffect (nav.pushState (unsafeToForeign {}) url) $> Nothing ]
    else noMessages $ model { savePending = false }

  AccountCreateFailed gen msg ->
    if gen /= model.saveGeneration then noMessages model
    else if model.route == Just AccountNew then noMessages $ model { errorMessage = Just msg, newAccountForm = model.newAccountForm { step = StepInput }, savePending = false }
    else noMessages $ model { savePending = false }

  -- One-time username setting (existing profile without a username)
  OpenSetUsername ->
    case model.selectedAccount of
      Loaded _ -> noMessages $ model { setUsernameDialog = Just emptySetUsernameDialog, errorMessage = Nothing }
      _ -> noMessages model

  CloseSetUsername ->
    if model.savePending then noMessages model
    else noMessages $ model { setUsernameDialog = Nothing, errorMessage = Nothing }

  SetSetUsernameInput value ->
    case model.setUsernameDialog of
      Just dialog ->
        Tuple (model { setUsernameDialog = Just (dialog { username = { value, verdict: Unverified }, step = StepInput }) })
          (settleCommands ForExistingProfile value)
      Nothing -> noMessages model

  ReviewSetUsername ->
    case model.setUsernameDialog of
      Just dialog | isAvailable dialog.username.value dialog.username.verdict && hostLoaded model && not model.savePending ->
        noMessages $ model { setUsernameDialog = Just (dialog { step = StepConfirm }), errorMessage = Nothing }
      _ -> noMessages model

  BackSetUsername ->
    case model.setUsernameDialog of
      Just dialog | not model.savePending ->
        noMessages $ model { setUsernameDialog = Just (dialog { step = StepInput }), errorMessage = Nothing }
      _ -> noMessages model

  ConfirmSetUsername ->
    case model.setUsernameDialog, model.selectedAccount of
      Just dialog, Loaded d ->
        if model.savePending || not (isAvailable dialog.username.value dialog.username.verdict) || not (hostLoaded model) then noMessages model
        else
          let
            AccountResponse acc = d.account
            newGen = model.saveGeneration + 1
          in
            case acc.profileId of
              Just profileId ->
                Tuple (model { errorMessage = Nothing, savePending = true, saveGeneration = newGen })
                  [ setUsernameAff newGen acc.id profileId dialog.username.value ]
              Nothing ->
                noMessages $ model { setUsernameDialog = Just (dialog { step = StepInput }), errorMessage = Just "ユーザー名を設定できませんでした (Profile を特定できません)" }
      _, _ -> noMessages model

  UsernameSaved gen accountId profile ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then case model.selectedAccount of
      Loaded d ->
        let
          AccountResponse acc = d.account
          ProfileResponse p = profile
        in
          noMessages $ model
            { selectedAccount = Loaded (d { profile = Just profile, account = AccountResponse (acc { profileUsername = p.username }) })
            , setUsernameDialog = Nothing
            , errorMessage = Nothing
            , savePending = false
            }
      _ -> noMessages $ model { setUsernameDialog = Nothing, savePending = false }
    else noMessages $ model { savePending = false }

  UsernameSaveFailed gen accountId msg ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then
      noMessages $ model
        { setUsernameDialog = map (\dialog -> dialog { step = StepInput }) model.setUsernameDialog
        , errorMessage = Just msg
        , savePending = false
        }
    else noMessages $ model { savePending = false }

  UsernameAlreadySet gen accountId msg ->
    -- Someone (another tab / device) set it first: close the dialog and show the stored value.
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then
      Tuple (model { setUsernameDialog = Nothing, errorMessage = Just msg, savePending = false })
        [ pure $ Just (FetchAccountDetail accountId) ]
    else noMessages $ model { savePending = false }

  -- Profile editing
  StartEditProfile ->
    case model.selectedAccount of
      Loaded d ->
        let
          form = case d.profile of
            Just (ProfileResponse p) ->
              { displayName: fromMaybe "" p.displayName
              , summary: fromMaybe "" p.summary
              , iconUrl: fromMaybe "" p.iconUrl
              , bannerUrl: fromMaybe "" p.bannerUrl
              }
            Nothing ->
              { displayName: "", summary: "", iconUrl: "", bannerUrl: "" }
        in
          noMessages $ model { editProfileForm = Just form, errorMessage = Nothing }
      _ -> noMessages model

  SetEditProfileDisplayName v ->
    case model.editProfileForm of
      Just form -> noMessages $ model { editProfileForm = Just (form { displayName = v }) }
      Nothing -> noMessages model

  SetEditProfileSummary v ->
    case model.editProfileForm of
      Just form -> noMessages $ model { editProfileForm = Just (form { summary = v }) }
      Nothing -> noMessages model

  SetEditProfileIconUrl v ->
    case model.editProfileForm of
      Just form -> noMessages $ model { editProfileForm = Just (form { iconUrl = v }) }
      Nothing -> noMessages model

  SetEditProfileBannerUrl v ->
    case model.editProfileForm of
      Just form -> noMessages $ model { editProfileForm = Just (form { bannerUrl = v }) }
      Nothing -> noMessages model

  SaveProfile ->
    case model.editProfileForm, model.selectedAccount of
      Just form, Loaded d ->
        if model.savePending then noMessages model
        else
          let
            AccountResponse acc = d.account
            trimmedDisplayName = trim form.displayName
            trimmedSummary = trim form.summary
            trimmedIconUrl = trim form.iconUrl
            trimmedBannerUrl = trim form.bannerUrl
            allEmpty = trimmedDisplayName == "" && trimmedSummary == "" && trimmedIconUrl == "" && trimmedBannerUrl == ""
            toTristate s = if s == "" then SetNull else Value s
            newGen = model.saveGeneration + 1
          in
            -- If all empty, send all SetNull to clear
            if allEmpty then noMessages $ model { editProfileForm = Nothing }
            else
              Tuple (model { errorMessage = Nothing, savePending = true, saveGeneration = newGen })
                [ saveProfileAff newGen acc.id
                    { displayName: toTristate trimmedDisplayName
                    , summary: toTristate trimmedSummary
                    , iconUrl: toTristate trimmedIconUrl
                    , bannerUrl: toTristate trimmedBannerUrl
                    }
                ]
      _, _ -> noMessages model

  ProfileSaved gen accountId profile ->
    -- Only apply if this is the most recent in-flight save AND we're still viewing the same account
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then case model.selectedAccount of
      Loaded d ->
        noMessages $ model
          { selectedAccount = Loaded (d { profile = Just profile })
          , editProfileForm = Nothing
          , errorMessage = Nothing
          , savePending = false
          }
      _ -> noMessages $ model { editProfileForm = Nothing, savePending = false }
    else noMessages $ model { savePending = false }

  ProfileSaveFailed gen accountId msg ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then noMessages $ model { errorMessage = Just msg, savePending = false }
    else noMessages $ model { savePending = false }

  CancelEditProfile ->
    noMessages $ model { editProfileForm = Nothing, errorMessage = Nothing }

  -- Metadata editing
  StartAddMetadata ->
    noMessages $ model { editMetadataForm = Just { id: Nothing, label: "", content: "" }, errorMessage = Nothing }

  StartEditMetadata nanoid ->
    case model.selectedAccount of
      Loaded d ->
        case findMetadata nanoid d.metadata of
          Just (MetadataResponse m) ->
            noMessages $ model { editMetadataForm = Just { id: Just nanoid, label: m.label, content: m.content }, errorMessage = Nothing }
          Nothing -> noMessages model
      _ -> noMessages model

  SetMetadataLabel v ->
    case model.editMetadataForm of
      Just form -> noMessages $ model { editMetadataForm = Just (form { label = v }) }
      Nothing -> noMessages model

  SetMetadataContent v ->
    case model.editMetadataForm of
      Just form -> noMessages $ model { editMetadataForm = Just (form { content = v }) }
      Nothing -> noMessages model

  SaveMetadata ->
    case model.editMetadataForm, model.selectedAccount of
      Just form, Loaded d ->
        if model.savePending then noMessages model
        else
          let
            trimmedLabel = trim form.label
            trimmedContent = trim form.content
            newGen = model.saveGeneration + 1
          in
            if trimmedLabel == "" || trimmedContent == "" then noMessages model
            else
              let
                AccountResponse acc = d.account
              in
                Tuple (model { errorMessage = Nothing, savePending = true, saveGeneration = newGen })
                  [ saveMetadataAff newGen acc.id form.id
                      { label: trimmedLabel, content: trimmedContent }
                  ]
      _, _ -> noMessages model

  MetadataSaved gen accountId meta ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then case model.selectedAccount of
      Loaded d ->
        let
          MetadataResponse m = meta
          newMetadata = case findMetadata m.nanoid d.metadata of
            Just _ -> map (\existing -> let MetadataResponse e = existing in if e.nanoid == m.nanoid then meta else existing) d.metadata
            Nothing -> d.metadata <> [ meta ]
        in
          noMessages $ model
            { selectedAccount = Loaded (d { metadata = newMetadata })
            , editMetadataForm = Nothing
            , errorMessage = Nothing
            , savePending = false
            }
      _ -> noMessages $ model { editMetadataForm = Nothing, savePending = false }
    else noMessages $ model { savePending = false }

  MetadataSaveFailed gen accountId msg ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then noMessages $ model { errorMessage = Just msg, savePending = false }
    else noMessages $ model { savePending = false }

  CancelMetadata ->
    noMessages $ model { editMetadataForm = Nothing, errorMessage = Nothing }

  DeleteMetadata nanoid ->
    case model.selectedAccount of
      Loaded d ->
        if model.savePending then noMessages model
        else
          let
            AccountResponse acc = d.account
            newGen = model.saveGeneration + 1
          in
            Tuple (model { errorMessage = Nothing, savePending = true, saveGeneration = newGen })
              [ deleteMetadataAff newGen acc.id nanoid ]
      _ -> noMessages model

  MetadataDeleted gen accountId nanoid ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then case model.selectedAccount of
      Loaded d ->
        let
          newMetadata = filter (\(MetadataResponse m) -> m.nanoid /= nanoid) d.metadata
        in
          noMessages $ model { selectedAccount = Loaded (d { metadata = newMetadata }), errorMessage = Nothing, savePending = false }
      _ -> noMessages $ model { savePending = false }
    else noMessages $ model { savePending = false }

  MetadataDeleteFailed gen accountId msg ->
    if gen /= model.saveGeneration then noMessages model
    else if currentAccountId model == Just accountId then noMessages $ model { errorMessage = Just msg, savePending = false }
    else noMessages $ model { savePending = false }

-- Helper: find metadata by nanoid
findMetadata :: String -> Array MetadataResponse -> Maybe MetadataResponse
findMetadata targetId = find (\(MetadataResponse r) -> r.nanoid == targetId)

-- | Check if an ApiError is a 401 (session expired / unauthorized)
isUnauthorized :: ApiError -> Boolean
isUnauthorized (HttpError 401 _) = true
isUnauthorized _ = false

-- Aff helpers: API calls that produce Messages

checkSessionAff :: Aff (Maybe Message)
checkSessionAff = do
  result <- Auth.checkSession
  pure $ Just $ case result of
    Right (SessionResponse r) ->
      if r.authenticated then SessionLoaded { username: r.username }
      else SessionFailed
    Left _ -> SessionFailed

fetchAccountsAff :: Aff (Maybe Message)
fetchAccountsAff = do
  result <- GraphQL.fetchAccounts
  pure $ Just $ case result of
    Right accs -> AccountsLoaded accs
    Left err | isUnauthorized err -> SessionExpired
    Left err -> AccountsFailed (printApiError err)

fetchAccountDetailAff :: String -> Aff (Maybe Message)
fetchAccountDetailAff id = do
  result <- GraphQL.fetchAccountDetail id
  pure $ Just $ case result of
    Left err | isUnauthorized err -> SessionExpired
    Left err -> AccountDetailFailed id (printApiError err)
    Right r ->
      let
        detail :: AccountWithDetails
        detail = { account: r.account, profile: r.profile, metadata: r.metadata }
      in
        AccountDetailLoaded id detail

submitNewAccountAff :: Int -> String -> Boolean -> String -> Aff (Maybe Message)
submitNewAccountAff gen name isBot username = do
  result <- GraphQL.createAccount name isBot username
  pure $ Just $ case result of
    Right acc -> AccountCreated gen acc
    Left err | isUnauthorized err -> SessionExpired
    Left err -> case createVerdictOf err of
      Just verdict -> UsernameRejected ForNewAccount gen Nothing username verdict
      Nothing -> AccountCreateFailed gen (printApiError err)

setUsernameAff :: Int -> String -> String -> String -> Aff (Maybe Message)
setUsernameAff gen accountId profileId username = do
  result <- GraphQL.setProfileUsername profileId username
  pure $ Just $ case result of
    Right profile -> UsernameSaved gen accountId profile
    Left err | isUnauthorized err -> SessionExpired
    Left err@(CodedError "USERNAME_ALREADY_SET" _) -> UsernameAlreadySet gen accountId (printApiError err)
    -- 409 the BFF could not tell apart (taken or already set): show the stored state instead of guessing
    Left err@(CodedError "USERNAME_CONFLICT" _) -> UsernameAlreadySet gen accountId (printApiError err)
    Left err -> case usernameVerdictOf err of
      Just verdict -> UsernameRejected ForExistingProfile gen (Just accountId) username verdict
      Nothing -> UsernameSaveFailed gen accountId (printApiError err)

-- | The submitted value itself was refused: shown under the input, not as a banner.
usernameVerdictOf :: ApiError -> Maybe Verdict
usernameVerdictOf = case _ of
  CodedError "USERNAME_INVALID_FORMAT" _ -> Just (Rejected ReasonFormat)
  CodedError "USERNAME_RESERVED" _ -> Just (Rejected ReasonReserved)
  CodedError "USERNAME_TAKEN" _ -> Just Taken
  _ -> Nothing

-- | Creating an account has one possible 409 cause (the name is taken), so a plain conflict is Taken there.
createVerdictOf :: ApiError -> Maybe Verdict
createVerdictOf = case _ of
  CodedError "USERNAME_CONFLICT" _ -> Just Taken
  err -> usernameVerdictOf err

-- | Ask the server about a username (format / reserved words) once typing paused.
checkUsernameAff :: UsernameTarget -> String -> Aff (Maybe Message)
checkUsernameAff target value = do
  result <- GraphQL.checkProfileUsername value
  pure $ case result of
    Left err | isUnauthorized err -> Just SessionExpired
    Right "VALID" -> Just (UsernameChecked target value Verified)
    Right "FORMAT" -> Just (UsernameChecked target value (Rejected ReasonFormat))
    Right "RESERVED" -> Just (UsernameChecked target value (Rejected ReasonReserved))
    _ -> Just (UsernameChecked target value Unavailable)

-- | Wait for typing to pause, then ask (stale results are dropped by comparing the value).
settleAff :: UsernameTarget -> String -> Aff (Maybe Message)
settleAff target value = do
  delay (Milliseconds 400.0)
  pure $ Just (UsernameSettled target value)

settleCommands :: UsernameTarget -> String -> Array (Aff (Maybe Message))
settleCommands target value = if shouldAskServer value then [ settleAff target value ] else []

fetchInstanceHostAff :: Aff (Maybe Message)
fetchInstanceHostAff = do
  result <- GraphQL.fetchInstanceHost
  pure $ Just case result of
    Right host -> InstanceHostLoaded host
    Left err | isUnauthorized err -> SessionExpired
    Left _ -> InstanceHostFailed

-- | The host is fetched once per session and retried only on demand after a failure.
needsHost :: Model -> Boolean
needsHost model = case model.instanceHost of
  NotAsked -> true
  Failed -> true
  _ -> false

markHost :: Model -> Model
markHost model = if needsHost model then model { instanceHost = Loading } else model

hostLoaded :: Model -> Boolean
hostLoaded model = case model.instanceHost of
  Loaded _ -> true
  _ -> false

-- | Add the instance host fetch to the page's initial commands.
withHost :: Model -> Array (Aff (Maybe Message)) -> Array (Aff (Maybe Message))
withHost model cmds = if needsHost model then cmds <> [ fetchInstanceHostAff ] else cmds

-- | The server already refused exactly this value as taken; a check answer that was in flight must not undo it.
usernameTaken :: Model -> UsernameTarget -> String -> Boolean
usernameTaken model target value = case target of
  ForNewAccount -> model.newAccountForm.username.value == value && model.newAccountForm.username.verdict == Taken
  ForExistingProfile -> map (\d -> d.username.value == value && d.username.verdict == Taken) model.setUsernameDialog == Just true

-- | The value is frozen: the confirmation step is showing, or its request is in flight.
usernameLocked :: Model -> UsernameTarget -> Boolean
usernameLocked model = case _ of
  ForNewAccount -> model.newAccountForm.step == StepConfirm || model.savePending
  ForExistingProfile -> model.savePending || map (_.step) model.setUsernameDialog == Just StepConfirm

-- | The account a username dialog belongs to (Nothing for the create modal).
usernameOwner :: Model -> UsernameTarget -> Maybe String
usernameOwner model = case _ of
  ForNewAccount -> Nothing
  ForExistingProfile -> currentAccountId model

-- | The value currently typed for a target (Nothing when that input is not open).
currentUsername :: Model -> UsernameTarget -> Maybe String
currentUsername model = case _ of
  ForNewAccount -> if model.route == Just AccountNew then Just model.newAccountForm.username.value else Nothing
  ForExistingProfile -> map (_.username.value) model.setUsernameDialog

-- | Record a server verdict, only if it is for the value currently in the field.
-- | A refused submission also goes back from the confirmation to the input.
withVerdict :: UsernameTarget -> String -> Verdict -> Model -> Model
withVerdict target value verdict model
  | currentUsername model target /= Just value = model
  | otherwise = case target of
      ForNewAccount ->
        model { newAccountForm = model.newAccountForm { username = { value, verdict }, step = backToInput verdict model.newAccountForm.step } }
      ForExistingProfile ->
        model { setUsernameDialog = map (\dialog -> dialog { username = { value, verdict }, step = backToInput verdict dialog.step }) model.setUsernameDialog }

backToInput :: Verdict -> DialogStep -> DialogStep
backToInput v step = case v of
  Verified -> step
  _ -> StepInput

saveProfileAff :: Int -> String -> { displayName :: Tristate String, summary :: Tristate String, iconUrl :: Tristate String, bannerUrl :: Tristate String } -> Aff (Maybe Message)
saveProfileAff gen accountId fields = do
  -- Mutation returns the updated profile directly; no re-fetch needed.
  result <- GraphQL.updateProfile accountId fields
  pure $ Just $ case result of
    Right profile -> ProfileSaved gen accountId profile
    Left err | isUnauthorized err -> SessionExpired
    Left err -> ProfileSaveFailed gen accountId (printApiError err)

saveMetadataAff :: Int -> String -> Maybe String -> { label :: String, content :: String } -> Aff (Maybe Message)
saveMetadataAff gen accountId mNanoid fields = do
  -- Mutations return the saved metadata directly; no re-fetch needed.
  result <- case mNanoid of
    Just nanoid -> GraphQL.updateMetadata accountId nanoid fields
    Nothing -> GraphQL.createMetadata accountId fields
  pure $ Just $ case result of
    Right meta -> MetadataSaved gen accountId meta
    Left err | isUnauthorized err -> SessionExpired
    Left err -> MetadataSaveFailed gen accountId (printApiError err)

deleteMetadataAff :: Int -> String -> String -> Aff (Maybe Message)
deleteMetadataAff gen accountId nanoid = do
  result <- GraphQL.deleteMetadata accountId nanoid
  pure $ Just $ case result of
    Right _ -> MetadataDeleted gen accountId nanoid
    Left err | isUnauthorized err -> SessionExpired
    Left err -> MetadataDeleteFailed gen accountId (printApiError err)

submitLoginAff :: String -> String -> Aff (Maybe Message)
submitLoginAff identifier password = do
  result <- Auth.login (LoginRequest { identifier, password })
  pure $ Just $ case result of
    Right (LoginResponse r) -> LoginSuccess r.username
    Left err -> LoginFailed (loginErrorMessage err)

logoutAff :: Aff (Maybe Message)
logoutAff = do
  result <- Auth.logout
  pure $ Just $ case result of
    Right _ -> LogoutDone
    Left err -> LogoutFailed (printApiError err)

loginErrorMessage :: ApiError -> String
loginErrorMessage = case _ of
  HttpError 401 _ -> "Login failed: incorrect email or password"
  HttpError 403 _ -> "Login failed: access denied"
  HttpError 404 _ -> "Login failed: authentication service unavailable"
  NetworkError _ -> "Login failed: network error"
  _ -> "Login failed"
