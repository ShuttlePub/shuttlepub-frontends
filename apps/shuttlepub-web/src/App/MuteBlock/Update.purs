-- | Update of the mute/block settings page (ui-spec 1-1 … 2-5).
-- |
-- | Light, reversible operations (unmute) run immediately with a "元に戻す"
-- | toast; adding goes through the "+" dialog and a confirmation; blocking shows
-- | what it detaches; unblocking asks once. Every write carries the revision it
-- | was based on, so a concurrent change surfaces as REVISION_CONFLICT instead
-- | of being overwritten, and a write in flight disables further writes.
module App.MuteBlock.Update (update) where

import Prelude

import App.MuteBlock.Api as Api
import App.MuteBlock.Dom (focusLater, reloadPage)
import App.MuteBlock.Types (ActorPolicy, Change(..), Dialog(..), DomainControl, Failure(..), Filter(..), InputProblem(..), Load(..), Message(..), Model, Undo(..), Write(..), actorLabel, blockReady, fromResult)
import Data.Array (filter, find, snoc)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Time.Duration (Milliseconds(..))
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff, delay)
import Effect.Class (liftEffect)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))

type Step = Tuple Model (Array (Aff (Maybe Message)))

noEffects :: Model -> Step
noEffects model = Tuple model []

effect :: forall a. Aff a -> (a -> Message) -> Aff (Maybe Message)
effect request toMessage = Just <<< toMessage <$> request

focus :: Array String -> Aff (Maybe Message)
focus ids = liftEffect (focusLater ids) $> Nothing

-- | Element ids shared with App.MuteBlock.View.
addInputId :: String
addInputId = "mb-add-input"

dialogFirstId :: String
dialogFirstId = "mb-dialog-first"

headingId :: String
headingId = "mb-heading"

toastSeconds :: Number
toastSeconds = 6000.0

update :: Model -> Message -> Step
update model = case _ of
  ProfileKnown (Right (Just profile)) ->
    load (model { profile = Just profile, profileKnown = true, dialog = Nothing, toast = Nothing })
  ProfileKnown (Right Nothing) ->
    noEffects model { profile = Nothing, profileKnown = true, domains = Failed (Failure "PROFILE_REQUIRED"), actors = Failed (Failure "PROFILE_REQUIRED") }
  ProfileKnown (Left failure) ->
    noEffects model { profile = Nothing, profileKnown = true, domains = Failed failure, actors = Failed failure }
  Reload -> load (model { dialog = Nothing, toast = Nothing, writing = false })
  DomainsLoaded profile result
    | model.profile == Just profile -> noEffects model { domains = fromResult result }
    | otherwise -> noEffects model
  ActorsLoaded profile result
    | model.profile == Just profile -> noEffects model { actors = fromResult result }
    | otherwise -> noEffects model
  SetDomainFilter value -> noEffects model { domainFilter = value }
  SetActorFilter value -> noEffects model { actorFilter = value }
  Go _ -> noEffects model
  OpenSettings -> noEffects model

  OpenAdd opener ->
    Tuple model { dialog = Just (AddDomain { input: "", problem: Nothing, pending: false }), opener = Just opener }
      [ focus [ addInputId ] ]
  AddInput input -> case model.dialog of
    Just (AddDomain state) -> noEffects model { dialog = Just (AddDomain state { input = input, problem = Nothing }) }
    _ -> noEffects model
  SubmitAdd mode -> case model.dialog of
    Just (AddDomain state) | not state.pending ->
      Tuple model { dialog = Just (AddDomain state { pending = true, problem = Nothing }) }
        [ effect (Api.checkDomain state.input) (AddChecked mode) ]
    _ -> noEffects model
  AddChecked mode result -> case model.dialog of
    Just (AddDomain state) -> case result of
      Left failure -> refuse state (InputFailed failure)
      Right { domain: Just domain } ->
        let
          current = findDomain domain
        in
          if map _.mode current == Just mode then refuse state (AlreadySet mode)
          else if mode == MUTE then
            Tuple model { dialog = Just (ConfirmMute { domain, current, fromInput: true, pending: false, failure: Nothing }) }
              [ focus [ dialogFirstId ] ]
          else openBlock domain current true
      Right { error } -> refuse state (InputRefused (fromMaybe "INVALID" error))
    _ -> noEffects model
  ImpactLoaded domain result -> case model.dialog of
    Just (ConfirmBlock state) | state.domain == domain ->
      noEffects model { dialog = Just (ConfirmBlock state { impact = fromResult result }) }
    _ -> noEffects model
  RetryImpact -> case model.dialog, model.profile of
    Just (ConfirmBlock state), Just profile | not state.pending ->
      Tuple model { dialog = Just (ConfirmBlock state { impact = Loading, acknowledged = false }) }
        [ effect (Api.fetchImpact profile state.domain) (ImpactLoaded state.domain) ]
    _, _ -> noEffects model
  ToggleAcknowledged value -> case model.dialog of
    Just (ConfirmBlock state) -> noEffects model { dialog = Just (ConfirmBlock state { acknowledged = value }) }
    _ -> noEffects model
  CloseDialog
    | dialogPending model -> noEffects model
    | otherwise -> Tuple model { dialog = Nothing } [ focus (openerIds model) ]

  ConfirmMuteDomain -> case model.dialog of
    Just (ConfirmMute state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmMute state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain MUTE (map _.revision state.current))
            (Written (if map _.mode state.current == Just BLOCK then DomainToMute else MuteDomain) state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  ConfirmBlockDomain -> case model.dialog of
    Just (ConfirmBlock state) | not state.pending, blockReady state, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmBlock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain BLOCK (map _.revision state.current))
            (Written BlockDomain state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  MuteInstead -> case model.dialog of
    Just (ConfirmBlock state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmBlock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain MUTE (map _.revision state.current))
            (Written MuteDomain state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  UnmuteDomain control
    | model.writing -> noEffects model
    | Just profile <- model.profile ->
        Tuple model { writing = true }
          [ effect (Api.removeDomainControl profile control.domain control.revision)
              (Written UnmuteDomainRow control.domain <<< map DomainRemoved)
          ]
    | otherwise -> noEffects model
  OpenDomainUnblock opener control ->
    Tuple model { dialog = Just (ConfirmDomainUnblock { control, pending: false, failure: Nothing }), opener = Just opener }
      [ focus [ dialogFirstId ] ]
  ConfirmDomainUnblockNow -> case model.dialog of
    Just (ConfirmDomainUnblock state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmDomainUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.removeDomainControl profile state.control.domain state.control.revision)
            (Written UnblockDomain state.control.domain <<< map DomainRemoved)
        ]
    _ -> noEffects model
  DomainUnblockToMute -> case model.dialog of
    Just (ConfirmDomainUnblock state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmDomainUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.control.domain MUTE (Just state.control.revision))
            (Written DomainToMute state.control.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model

  UnmuteActor policy
    | model.writing -> noEffects model
    | Just profile <- model.profile ->
        Tuple model { writing = true }
          [ effect (Api.removeActorPolicy profile policy.id MUTE)
              (Written (UnmuteActorRow policy.actorUrl) (actorLabel policy.actorUrl) <<< map ActorRemoved)
          ]
    | otherwise -> noEffects model
  OpenActorUnblock opener policy ->
    Tuple model { dialog = Just (ConfirmActorUnblock { policy, pending: false, failure: Nothing }), opener = Just opener }
      [ focus [ dialogFirstId ] ]
  ConfirmActorUnblockNow -> case model.dialog of
    Just (ConfirmActorUnblock state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmActorUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.removeActorPolicy profile state.policy.id BLOCK)
            (Written UnblockActor (actorLabel state.policy.actorUrl) <<< map ActorRemoved)
        ]
    _ -> noEffects model
  ActorUnblockToMute -> case model.dialog of
    Just (ConfirmActorUnblock state) | not state.pending, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmActorUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (actorToMute profile state.policy) (Written ActorToMute (actorLabel state.policy.actorUrl)) ]
    _ -> noEffects model

  Written write subject (Left failure) -> case model.dialog of
    Just dialog | dialogPending model ->
      noEffects model { dialog = Just (withFailure failure dialog), writing = false }
    _ ->
      let
        Tuple next effects = showToast (model { writing = false }) { subject, rest: "", undo: Nothing, failure: Just failure }
      in
        Tuple next (effects <> reloadAfter model write)
  Written write subject (Right change) ->
    let
      -- Only the dialog that sent this write closes: a row action or "元に戻す"
      -- finishing later leaves a dialog opened meanwhile (and its input) alone.
      fromDialog = dialogPending model
      applied = applyChange change (model { writing = false, dialog = if fromDialog then Nothing else model.dialog })
      refocus = if fromDialog then [ focus (openerIds model) ] else []
      Tuple next effects = case notice write subject of
        Just toast -> showToast (resetFilter write applied) toast
        Nothing -> noEffects applied { toast = Nothing }
    in
      Tuple next (effects <> refocus <> reloadAfter model write)
  RunUndo -> case model.toast, model.profile of
    Just { undo: Just undo }, Just profile | not model.writing && model.dialog == Nothing -> case undo of
      RestoreDomainMute domain ->
        Tuple model { writing = true, toast = Nothing }
          [ effect (Api.setDomainControl profile domain MUTE Nothing) (Written UndoWrite domain <<< map DomainUpserted) ]
      RestoreActorMute actorUrl ->
        Tuple model { writing = true, toast = Nothing }
          [ effect (Api.addActorPolicy profile actorUrl MUTE) (Written UndoWrite (actorLabel actorUrl) <<< map ActorAdded) ]
    _, _ -> noEffects model
  ToastHold held -> case model.toast of
    Just toast ->
      Tuple model { toast = Just toast { held = held } }
        (if held then [] else [ dismissLater toast.id ])
    Nothing -> noEffects model
  DismissToast id -> case model.toast of
    Just toast | toast.id == id && not toast.held -> noEffects model { toast = Nothing }
    _ -> noEffects model
  ReloadPage -> Tuple model [ liftEffect reloadPage $> Nothing ]
  NoOp -> noEffects model
  where
  findDomain :: String -> Maybe DomainControl
  findDomain domain = case model.domains of
    Ready list -> find (\control -> control.domain == domain) list
    _ -> Nothing

  refuse state problem =
    Tuple model { dialog = Just (AddDomain state { pending = false, problem = Just problem }) } [ focus [ addInputId ] ]

  openBlock domain current fromInput = case model.profile of
    Just profile ->
      Tuple
        model
          { dialog = Just
              ( ConfirmBlock
                  { domain, current, fromInput, impact: Loading, acknowledged: false, pending: false, failure: Nothing }
              )
          }
        [ effect (Api.fetchImpact profile domain) (ImpactLoaded domain), focus [ dialogFirstId ] ]
    Nothing -> noEffects model

-- | Loads both lists for the shown Profile.
load :: Model -> Step
load model = case model.profile of
  Just profile ->
    Tuple model { domains = Loading, actors = Loading }
      [ effect (Api.fetchDomainControls profile) (DomainsLoaded profile)
      , effect (Api.fetchActorPolicies profile) (ActorsLoaded profile)
      ]
  Nothing -> noEffects model

-- | Mute first, then remove the block: a failure in between leaves the target
-- | muted and blocked (never neither). An existing mute is fine.
actorToMute :: String -> ActorPolicy -> Aff (Either Failure Change)
actorToMute profile policy = do
  muted <- Api.addActorPolicy profile policy.actorUrl MUTE
  case muted of
    Left failure | failure /= Failure "ALREADY_EXISTS" -> pure (Left failure)
    _ -> map ActorRemoved <$> Api.removeActorPolicy profile policy.id BLOCK

dialogPending :: Model -> Boolean
dialogPending model = case model.dialog of
  Just (AddDomain state) -> state.pending
  Just (ConfirmMute state) -> state.pending
  Just (ConfirmBlock state) -> state.pending
  Just (ConfirmDomainUnblock state) -> state.pending
  Just (ConfirmActorUnblock state) -> state.pending
  Nothing -> false

withFailure :: Failure -> Dialog -> Dialog
withFailure failure = case _ of
  AddDomain state -> AddDomain state { pending = false, problem = Just (InputFailed failure) }
  ConfirmMute state -> ConfirmMute state { pending = false, failure = Just failure }
  ConfirmBlock state -> ConfirmBlock state { pending = false, failure = Just failure }
  ConfirmDomainUnblock state -> ConfirmDomainUnblock state { pending = false, failure = Just failure }
  ConfirmActorUnblock state -> ConfirmActorUnblock state { pending = false, failure = Just failure }

openerIds :: Model -> Array String
openerIds model = case model.opener of
  Just opener -> [ opener, headingId ]
  Nothing -> [ headingId ]

applyChange :: Change -> Model -> Model
applyChange change model = case change of
  DomainUpserted control -> model { domains = mapReady (\list -> snoc (filter (\c -> c.domain /= control.domain) list) control) model.domains }
  DomainRemoved domain -> model { domains = mapReady (filter (\c -> c.domain /= domain)) model.domains }
  ActorAdded policy -> model { actors = mapReady (\list -> snoc list policy) model.actors }
  ActorRemoved id -> model { actors = mapReady (filter (\p -> p.id /= id)) model.actors }
  ActorSwapped id policy -> model { actors = mapReady (\list -> snoc (filter (\p -> p.id /= id) list) policy) model.actors }
  where
  mapReady :: forall a. (a -> a) -> Load a -> Load a
  mapReady f = case _ of
    Ready value -> Ready (f value)
    other -> other

-- | The mock resets the list filter after adding (so the new row is visible).
resetFilter :: Write -> Model -> Model
resetFilter write model = case write of
  MuteDomain -> model { domainFilter = AllModes }
  BlockDomain -> model { domainFilter = AllModes }
  _ -> model

notice :: Write -> String -> Maybe { subject :: String, rest :: String, undo :: Maybe Undo, failure :: Maybe Failure }
notice write subject = case write of
  MuteDomain -> plain " をミュートしました"
  BlockDomain -> plain " をブロックしました"
  UnmuteDomainRow -> Just { subject, rest: " のミュートを解除しました", undo: Just (RestoreDomainMute subject), failure: Nothing }
  UnblockDomain -> plain " のブロックを解除しました"
  DomainToMute -> plain " をミュートに変更しました"
  UnmuteActorRow actorUrl -> Just { subject, rest: " のミュートを解除しました", undo: Just (RestoreActorMute actorUrl), failure: Nothing }
  UnblockActor -> plain " のブロックを解除しました"
  ActorToMute -> plain " をミュートに変更しました"
  UndoWrite -> Nothing
  where
  plain rest = Just { subject, rest, undo: Nothing, failure: Nothing }

-- | Changing an individual block into a mute replaces a row Emumet assigns a
-- | new id to; refetch rather than guess it.
reloadAfter :: Model -> Write -> Array (Aff (Maybe Message))
reloadAfter model = case _, model.profile of
  ActorToMute, Just profile -> [ effect (Api.fetchActorPolicies profile) (ActorsLoaded profile) ]
  _, _ -> []

showToast :: Model -> { subject :: String, rest :: String, undo :: Maybe Undo, failure :: Maybe Failure } -> Step
showToast model toast =
  let
    id = model.toastSeq + 1
  in
    Tuple model { toast = Just { id, subject: toast.subject, rest: toast.rest, undo: toast.undo, failure: toast.failure, held: false }, toastSeq = id }
      [ dismissLater id ]

dismissLater :: Int -> Aff (Maybe Message)
dismissLater id = delay (Milliseconds toastSeconds) $> Just (DismissToast id)
