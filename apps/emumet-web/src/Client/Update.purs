module Client.Update where

import Prelude

import App.Api.Client (ApiError(..), printApiError)
import App.Api.Auth as Auth
import App.Api.Auth (LoginRequest(..), LoginResponse(..), SessionResponse(..))
import App.Api.GraphQL as GraphQL
import App.Api.GraphQL.Types (AccountResponse(..), MetadataResponse(..), ProfileResponse(..), Tristate(..))
import App.Admin.Types (emptyAdminModel)
import App.Message (Message(..))
import Client.Admin (enterRoute, fetchViewerAff, updateAdmin)
import App.Model (AccountWithDetails, Model, RemoteData(..), emptyLoginForm, emptyNewAccountForm, isProtectedRoute, pageForMaybeRoute)
import App.Route (Route(..), routeCodec)
import Data.Array (filter, find)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), fromMaybe, isJust, isNothing)
import Data.String.Common (trim)
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
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
mkUpdate nav model msg = case msg of
  Admin adminMsg -> updateAdmin model adminMsg
  SessionLoaded _ ->
    -- 管理画面の導線 (nav の「管理」・ベル) を出すかのヒントを取る。権限判断の正本は各管理 API
    let
      Tuple m fx = baseUpdate nav model msg
    in
      Tuple m (fx <> [ fetchViewerAff ])
  UrlChanged _ | model.isHydrated ->
    let
      Tuple m fx = baseUpdate nav model msg
    in
      Tuple (m { admin = m.admin { bellOpen = false, modal = Nothing, error = Nothing } }) (fx <> enterRoute m.route m)
  SessionExpired -> resetAdmin (baseUpdate nav model msg)
  -- 適用された SessionFailed (確認済みの session が無い) は管理画面の状態も捨てる
  SessionFailed | not (isJust model.session && model.sessionVerified) -> resetAdmin (baseUpdate nav model msg)
  LogoutDone -> resetAdmin (baseUpdate nav model msg)
  _ -> baseUpdate nav model msg

resetAdmin :: Tuple Model (Array (Aff (Maybe Message))) -> Tuple Model (Array (Aff (Maybe Message)))
resetAdmin (Tuple m fx) = Tuple (m { admin = emptyAdminModel }) fx

baseUpdate :: PushStateInterface -> Update Model Message
baseUpdate nav model = case _ of
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
        base = model { route = effectiveRoute, page = pageForMaybeRoute effectiveRoute, editProfileForm = Nothing, editMetadataForm = Nothing, errorMessage = Nothing, savePending = false }
      in
        if needsAuth then
          Tuple base
            [ liftEffect (nav.replaceState (unsafeToForeign {}) (print routeCodec Login)) $> Nothing ]
        else
          case mRoute of
            Just Home ->
              Tuple (base { accounts = Loading }) [ pure $ Just FetchAccounts ]
            Just (AccountDetail id) ->
              Tuple (base { selectedAccount = Loading }) [ pure $ Just (FetchAccountDetail id) ]
            Just AccountNew ->
              noMessages $ base { newAccountForm = emptyNewAccountForm }
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
      m = model { session = Just sessionInfo, sessionVerified = true }
    in
      case m.route of
        Just r | isProtectedRoute r ->
          -- Authenticated, dispatch page-specific init
          case m.route of
            Just Home ->
              Tuple (m { accounts = Loading }) [ pure $ Just FetchAccounts ]
            Just (AccountDetail id) ->
              Tuple (m { selectedAccount = Loading }) [ pure $ Just (FetchAccountDetail id) ]
            Just AccountNew ->
              noMessages $ m { newAccountForm = emptyNewAccountForm }
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
    -- Ignore stale SessionFailed if we already have a session confirmed by this client
    -- (e.g., startup CheckSession returns after successful LoginSuccess). A session that only came
    -- from the admin page SSR is not confirmed yet, so its first 401 is applied.
    if isJust model.session && model.sessionVerified then noMessages model
    else
      let
        m = model { session = Nothing, sessionVerified = false, savePending = false, editProfileForm = Nothing, editMetadataForm = Nothing }
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
    if model.route == Just Home then noMessages $ model { accounts = Loaded accs }
    else noMessages model

  AccountsFailed msg ->
    if model.route == Just Home then noMessages $ model { accounts = Failed, errorMessage = Just msg }
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

  -- New account form
  SetNewAccountName name ->
    noMessages $ model { newAccountForm = model.newAccountForm { name = name } }

  SetNewAccountIsBot isBot ->
    noMessages $ model { newAccountForm = model.newAccountForm { isBot = isBot } }

  SubmitNewAccount ->
    let
      form = model.newAccountForm
      trimmedName = trim form.name
    in
      if trimmedName == "" || model.savePending then noMessages model
      else
        Tuple (model { errorMessage = Nothing, savePending = true })
          [ submitNewAccountAff trimmedName form.isBot ]

  AccountCreated (AccountResponse acc) ->
    -- Guard: only navigate if still on AccountNew page
    if model.route == Just AccountNew then
      let
        url = print routeCodec (AccountDetail acc.id)
      in
        Tuple (model { newAccountForm = emptyNewAccountForm, errorMessage = Nothing, savePending = false })
          [ liftEffect (nav.pushState (unsafeToForeign {}) url) $> Nothing ]
    else noMessages $ model { savePending = false }

  AccountCreateFailed msg ->
    -- Guard: only show error if still on AccountNew page
    if model.route == Just AccountNew then noMessages $ model { errorMessage = Just msg, savePending = false }
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

  -- mkUpdate が先に処理する
  Admin _ -> noMessages model

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

submitNewAccountAff :: String -> Boolean -> Aff (Maybe Message)
submitNewAccountAff name isBot = do
  result <- GraphQL.createAccount name isBot
  pure $ Just $ case result of
    Right acc -> AccountCreated acc
    Left err | isUnauthorized err -> SessionExpired
    Left err -> AccountCreateFailed (printApiError err)

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
