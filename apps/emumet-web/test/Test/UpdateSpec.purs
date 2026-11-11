module Test.UpdateSpec where

import Prelude

import App.Api.GraphQL.Types (AccountResponse(..))
import App.Message (Message(..), UsernameTarget(..))
import App.Model (DialogStep(..), Model, RemoteData(..), emptyNewAccountForm, emptySetUsernameDialog)
import App.Route (Route(..))
import App.Username (Reason(..), Verdict(..))
import Client.Update (mkUpdate)
import Data.Maybe (Maybe(..))
import Data.Foldable (for_)
import Data.Tuple (fst)
import Effect (Effect)
import Test.Util (check)
import Unsafe.Coerce (unsafeCoerce)

-- | The state transitions behind the username dialogs. `mkUpdate` needs a PushStateInterface only for
-- | navigation; none of the messages below navigate, so a placeholder is enough.
step :: Model -> Message -> Model
step model message = fst (mkUpdate (unsafeCoerce unit) model message)

account :: String -> AccountResponse
account id = AccountResponse
  { createdAt: "2026-01-01T00:00:00Z"
  , displayName: Nothing
  , id
  , isBot: false
  , moderation: Nothing
  , name: id
  , profileId: Just ("prof_" <> id)
  , profileUsername: Nothing
  , publicKey: Nothing
  }

base :: Model
base =
  { route: Just AccountNew
  , page: unsafeCoerce unit
  , isHydrated: true
  , session: Just { username: "u" }
  , loginForm: { identifier: "", password: "" }
  , accounts: Loaded []
  , selectedAccount: NotAsked
  , newAccountForm: emptyNewAccountForm
  , editProfileForm: Nothing
  , editMetadataForm: Nothing
  , setUsernameDialog: Nothing
  , instanceHost: Loaded "emumet.example"
  , errorMessage: Nothing
  , savePending: false
  , saveGeneration: 0
  }

-- | The create modal with a name and an available username, `submitting` when Create was confirmed.
creating :: Int -> Boolean -> Model
creating gen submitting = base
  { newAccountForm = emptyNewAccountForm { name = "N", username = { value: "alice", verdict: Verified }, step = StepConfirm }
  , savePending = submitting
  , saveGeneration = gen
  }

-- | The set dialog on account `id` (loaded), with an available username.
setting :: String -> Int -> Boolean -> Model
setting id gen submitting = base
  { route = Just (AccountDetail id)
  , selectedAccount = Loaded { account: account id, profile: Nothing, metadata: [] }
  , setUsernameDialog = Just (emptySetUsernameDialog { username = { value: "bob", verdict: Verified }, step = StepConfirm })
  , savePending = submitting
  , saveGeneration = gen
  }

verdictOfNew :: Model -> Verdict
verdictOfNew m = m.newAccountForm.username.verdict

verdictOfSet :: Model -> Maybe Verdict
verdictOfSet m = map (_.username.verdict) m.setUsernameDialog

run :: Effect Unit
run = do
  let typedNewForCheck = base { newAccountForm = emptyNewAccountForm { name = "N", username = { value: "alice", verdict: Unverified } } }
  -- a late rejection must not change another operation's state
  let rejected = UsernameRejected ForNewAccount
  let inFlight = creating 5 true
  check "rejection of the current create applies: verdict, back to input, not pending" true
    (let m = step inFlight (rejected 5 Nothing "alice" Taken) in verdictOfNew m == Taken && m.newAccountForm.step == StepInput && not m.savePending)
  check "stale generation is ignored (a newer create is still pending)" true
    (let m = step inFlight (rejected 4 Nothing "alice" Taken) in verdictOfNew m == Verified && m.savePending && m.newAccountForm.step == StepConfirm)
  check "a different typed value is ignored" true
    (let m = step inFlight (rejected 5 Nothing "alice2" Taken) in verdictOfNew m == Verified && m.savePending)
  check "after leaving the page a late rejection changes nothing" true
    (let m = step (inFlight { route = Just Home }) (rejected 5 Nothing "alice" Taken) in verdictOfNew m == Verified && m.savePending)
  check "a rejection addressed to an account is ignored by the create modal" true
    (let m = step inFlight (rejected 5 (Just "acc_1") "alice" Taken) in verdictOfNew m == Verified && m.savePending)
  check "late AccountCreated of an older generation is ignored" true
    (let m = step inFlight (AccountCreated 4 (account "acc_9")) in m.savePending && m.route == Just AccountNew)
  check "late AccountCreateFailed of an older generation is ignored" true
    (let m = step inFlight (AccountCreateFailed 4 "boom") in m.savePending && m.errorMessage == Nothing)
  check "the current AccountCreateFailed returns to the input step with the message" true
    (let m = step inFlight (AccountCreateFailed 5 "boom") in not m.savePending && m.errorMessage == Just "boom" && m.newAccountForm.step == StepInput)

  let setInFlight = setting "acc_1" 7 true
  check "rejection of the current set applies" true
    (let m = step setInFlight (UsernameRejected ForExistingProfile 7 (Just "acc_1") "bob" (Rejected ReasonReserved)) in verdictOfSet m == Just (Rejected ReasonReserved) && not m.savePending)
  check "a rejection for another account is ignored" true
    (let m = step setInFlight (UsernameRejected ForExistingProfile 7 (Just "acc_2") "bob" Taken) in verdictOfSet m == Just Verified && m.savePending)
  check "a rejection of an older generation is ignored" true
    (let m = step setInFlight (UsernameRejected ForExistingProfile 6 (Just "acc_1") "bob" Taken) in verdictOfSet m == Just Verified && m.savePending)
  check "late already-set of an older generation is ignored" true
    (let m = step setInFlight (UsernameAlreadySet 6 "acc_1" "x") in m.setUsernameDialog /= Nothing && m.savePending)
  check "switching the account (UrlChanged) closes the dialog and invalidates the pending generation" true
    (let m = step setInFlight (UrlChanged (Just (AccountDetail "acc_2"))) in m.setUsernameDialog == Nothing && not m.savePending && m.saveGeneration > 7)
  check "so a late rejection after switching accounts changes nothing" true
    (let switched = step setInFlight (UrlChanged (Just (AccountDetail "acc_2"))) in (step switched (UsernameRejected ForExistingProfile 7 (Just "acc_1") "bob" Taken)).setUsernameDialog == Nothing)

  -- a late validation answer must not touch a confirmation or a request in flight
  check "a late check answer is ignored under the create confirmation" true
    (let m = step (creating 1 false) (UsernameChecked ForNewAccount "alice" Taken) in verdictOfNew m == Verified)
  check "a late check answer is ignored while the create is in flight" true
    (let m = step inFlight (UsernameChecked ForNewAccount "alice" Taken) in verdictOfNew m == Verified)
  check "a late check answer is ignored under the set confirmation" true
    (let m = step (setting "acc_1" 1 false) (UsernameChecked ForExistingProfile "bob" Taken) in verdictOfSet m == Just Verified)
  check "a check answer for the typed value still applies on the input step" true
    (let m = step typedNewForCheck (UsernameChecked ForNewAccount "alice" Taken) in verdictOfNew m == Taken)
  check "a check answer for an older value is ignored on the input step" true
    (let m = step typedNewForCheck (UsernameChecked ForNewAccount "alic" Taken) in verdictOfNew m == Unverified)
  check "a late Verified does not undo a taken verdict for the same value" true
    (let m = step (typedNewForCheck { newAccountForm = emptyNewAccountForm { name = "N", username = { value: "alice", verdict: Taken } } }) (UsernameChecked ForNewAccount "alice" Verified) in verdictOfNew m == Taken)
  check "a late Verified does not undo a taken verdict in the set dialog" true
    (let m = step ((setting "acc_1" 1 false) { setUsernameDialog = Just (emptySetUsernameDialog { username = { value: "bob", verdict: Taken } }) }) (UsernameChecked ForExistingProfile "bob" Verified) in verdictOfSet m == Just Taken)

  -- back / cancel while a request is in flight are refused; back otherwise returns to the input
  check "Back is refused while the create is in flight" true
    ((step inFlight BackNewAccount).newAccountForm.step == StepConfirm)
  check "Back returns to the input step" true
    ((step (creating 1 false) BackNewAccount).newAccountForm.step == StepInput)
  check "Cancel is refused while the create is in flight" true
    ((step inFlight CloseNewAccount).savePending)
  check "Back is refused while the set is in flight" true
    ((step setInFlight BackSetUsername).setUsernameDialog == (setInFlight.setUsernameDialog))

  -- nothing is confirmed until the host is known (the confirmation shows the finished ID)
  let typedNew = base { newAccountForm = emptyNewAccountForm { name = "N", username = { value: "alice", verdict: Verified } } }
  check "Create goes to the confirmation when the host is known" true
    ((step typedNew ReviewNewAccount).newAccountForm.step == StepConfirm)
  for_ [ NotAsked, Loading, Failed ] \host ->
    check "Create does not reach the confirmation while the host is not loaded" true
      ((step (typedNew { instanceHost = host }) ReviewNewAccount).newAccountForm.step == StepInput)
  check "Submit is refused without a known host" true
    (not (step ((creating 1 false) { instanceHost = Failed }) SubmitNewAccount).savePending)
  let typedSet = (setting "acc_1" 1 false) { setUsernameDialog = Just (emptySetUsernameDialog { username = { value: "bob", verdict: Verified } }) }
  check "Set goes to the confirmation when the host is known" true
    ((step typedSet ReviewSetUsername).setUsernameDialog == Just (emptySetUsernameDialog { username = { value: "bob", verdict: Verified }, step = StepConfirm }))
  check "Set does not reach the confirmation without a known host" true
    (map (_.step) (step (typedSet { instanceHost = Failed }) ReviewSetUsername).setUsernameDialog == Just StepInput)
  check "Confirming a set is refused without a known host" true
    (not (step ((setting "acc_1" 1 false) { instanceHost = Loading }) ConfirmSetUsername).savePending)
  check "Retry marks the host as loading only after a failure" true
    ( case (step (base { instanceHost = Failed }) RetryInstanceHost).instanceHost of
        Loading -> true
        _ -> false
    )
  check "Retry does nothing when the host is already known" true
    ( case (step base RetryInstanceHost).instanceHost of
        Loaded "emumet.example" -> true
        _ -> false
    )
  check "A failed host fetch is recorded, a later success replaces it" true
    ( case (step (step base InstanceHostFailed) (InstanceHostLoaded "h.example")).instanceHost of
        Loaded "h.example" -> true
        _ -> false
    )
