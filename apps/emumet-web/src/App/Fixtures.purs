module App.Fixtures where

import App.Admin.Types (emptyAdminModel)
import Prelude

import App.Api.GraphQL.Types (AccountResponse(..), MetadataResponse(..), ProfileResponse(..))
import App.Model (DialogStep(..), Model, RemoteData(..), UsernameField, emptyNewAccountForm, emptySetUsernameDialog, pageForMaybeRoute)
import App.Route (Route(..), routeCodec)
import App.Username (Reason(..), Verdict(..))
import Data.Maybe (Maybe(..))
import Routing.Duplex (print)

-- | One server-rendered state of the app. The hydration check (apps/ui-catalog/visual/screens/emumet-verify.ts)
-- | serves each of these as the SSR page and asserts that resuming it in a browser does not touch the DOM
-- | and raises no error, so every state the username screens can be in is covered, not only the initial one.
type Fixture =
  { id :: String
  , path :: String
  , model :: Model
  }

alice :: AccountResponse
alice = AccountResponse
  { createdAt: "2025-01-15T09:00:00Z"
  , displayName: Just "Alice Wonderland"
  , id: "acc_01"
  , isBot: false
  , moderation: Nothing
  , name: "alice"
  , profileId: Just "prof_01"
  , profileUsername: Just "alice"
  , publicKey: Nothing
  }

bob :: AccountResponse
bob = AccountResponse
  { createdAt: "2025-02-20T14:30:00Z"
  , displayName: Just "Bob Builder"
  , id: "acc_02"
  , isBot: false
  , moderation: Nothing
  , name: "bob"
  , profileId: Just "prof_02"
  , profileUsername: Nothing
  , publicKey: Nothing
  }

newsBot :: AccountResponse
newsBot = AccountResponse
  { createdAt: "2025-03-10T00:00:00Z"
  , displayName: Nothing
  , id: "acc_03"
  , isBot: true
  , moderation: Nothing
  , name: "bot-news"
  , profileId: Just "prof_03"
  , profileUsername: Just "bot-news"
  , publicKey: Nothing
  }

profile :: String -> Maybe String -> Maybe String -> ProfileResponse
profile accountId displayName username = ProfileResponse
  { accountId
  , bannerUrl: Nothing
  , displayName
  , iconUrl: Nothing
  , nanoid: "prof_" <> accountId
  , summary: Just "Hello"
  , username
  }

metadata :: MetadataResponse
metadata = MetadataResponse { accountId: "acc_01", content: "https://alice.example.com", label: "Website", nanoid: "0" }

start :: Route -> Model
start route =
  { route: Just route
  , page: pageForMaybeRoute (Just route)
  , isHydrated: false
  , session: Just { username: "visual-review@example.com" }
  , sessionVerified: false
  , loginForm: { identifier: "", password: "" }
  , accounts: Loaded [ alice, bob, newsBot ]
  , selectedAccount: NotAsked
  , newAccountForm: emptyNewAccountForm
  , editProfileForm: Nothing
  , editMetadataForm: Nothing
  , setUsernameDialog: Nothing
  , instanceHost: Loaded "emumet.example"
  , errorMessage: Nothing
  , savePending: false
  , saveGeneration: 0
  , admin: emptyAdminModel
  }

field :: String -> Verdict -> UsernameField
field value verdict = { value, verdict }

fixture :: String -> Model -> Fixture
fixture id model = { id, path: maybePath model.route, model }
  where
  maybePath = case _ of
    Just r -> print routeCodec r
    Nothing -> "/"

creating :: String -> UsernameField -> DialogStep -> Model -> Model
creating name username step m =
  m { newAccountForm = emptyNewAccountForm { name = name, username = username, step = step } }

detail :: AccountResponse -> Maybe ProfileResponse -> Model -> Model
detail account prof m =
  m { selectedAccount = Loaded { account, profile: prof, metadata: [ metadata ] } }

setting :: UsernameField -> DialogStep -> Model -> Model
setting username step m =
  m { setUsernameDialog = Just (emptySetUsernameDialog { username = username, step = step }) }

fixtures :: Array Fixture
fixtures =
  [ fixture "home-loaded" (start Home)
  , fixture "home-empty" ((start Home) { accounts = Loaded [] })
  , fixture "home-failed" ((start Home) { accounts = Failed, errorMessage = Just "Failed to load" })
  , fixture "home-host-unknown" ((start Home) { instanceHost = Loading })
  , fixture "new-empty" (start AccountNew)
  , fixture "new-checking" (creating "N" (field "alice" Unverified) StepInput (start AccountNew))
  , fixture "new-available" (creating "N" (field "alice" Verified) StepInput (start AccountNew))
  , fixture "new-format" (creating "N" (field "Alice" Unverified) StepInput (start AccountNew))
  , fixture "new-reserved" (creating "N" (field "admin" Unverified) StepInput (start AccountNew))
  , fixture "new-too-long" (creating "N" (field "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" Unverified) StepInput (start AccountNew))
  , fixture "new-taken" (creating "N" (field "alice" Taken) StepInput (start AccountNew))
  , fixture "new-server-format" (creating "N" (field "alice" (Rejected ReasonFormat)) StepInput (start AccountNew))
  , fixture "new-unavailable" (creating "N" (field "alice" Unavailable) StepInput (start AccountNew))
  , fixture "new-error-banner" ((creating "N" (field "alice" Verified) StepInput (start AccountNew)) { errorMessage = Just "このアカウントは停止中のため設定できません" })
  , fixture "new-confirm" (creating "N" (field "alice" Verified) StepConfirm (start AccountNew))
  , fixture "new-confirm-pending" ((creating "N" (field "alice" Verified) StepConfirm (start AccountNew)) { savePending = true })
  , fixture "new-host-failed" ((creating "N" (field "alice" Verified) StepInput (start AccountNew)) { instanceHost = Failed })
  , fixture "new-host-loading" ((creating "N" (field "alice" Verified) StepInput (start AccountNew)) { instanceHost = Loading })
  , fixture "detail-set" (detail alice (Just (profile "acc_01" (Just "Alice Wonderland") (Just "alice"))) (start (AccountDetail "acc_01")))
  , fixture "detail-unset" (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02")))
  , fixture "detail-no-display-name" (detail bob (Just (profile "acc_02" Nothing (Just "bob"))) (start (AccountDetail "acc_02")))
  , fixture "detail-no-display-name-no-username" (detail bob (Just (profile "acc_02" Nothing Nothing)) (start (AccountDetail "acc_02")))
  , fixture "detail-no-profile" (detail bob Nothing (start (AccountDetail "acc_02")))
  , fixture "detail-error-banner" ((detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))) { errorMessage = Just "この操作は現在サポートされていません" })
  , fixture "detail-edit-profile" ((detail alice (Just (profile "acc_01" (Just "Alice Wonderland") (Just "alice"))) (start (AccountDetail "acc_01"))) { editProfileForm = Just { displayName: "A", summary: "S", iconUrl: "", bannerUrl: "" } })
  , fixture "detail-edit-metadata" ((detail alice (Just (profile "acc_01" (Just "Alice Wonderland") (Just "alice"))) (start (AccountDetail "acc_01"))) { editMetadataForm = Just { id: Nothing, label: "L", content: "C" } })
  , fixture "set-empty" (setting (field "" Unverified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-checking" (setting (field "bob" Unverified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-available" (setting (field "bob" Verified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-reserved" (setting (field "admin" Unverified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-taken" (setting (field "alice" Taken) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-confirm" (setting (field "bob" Verified) StepConfirm (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02"))))
  , fixture "set-confirm-pending" ((setting (field "bob" Verified) StepConfirm (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02")))) { savePending = true })
  , fixture "set-host-failed" ((setting (field "bob" Verified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02")))) { instanceHost = Failed })
  , fixture "set-error-banner" ((setting (field "bob" Verified) StepInput (detail bob (Just (profile "acc_02" (Just "Bob Builder") Nothing)) (start (AccountDetail "acc_02")))) { errorMessage = Just "この操作は許可されていません" })
  , fixture "help" (start UsernameHelp)
  , fixture "login" ((start Login) { session = Nothing })
  , fixture "settings" (start Settings)
  ]
