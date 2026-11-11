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
import App.MuteBlock.Types (ActorPolicy, Change(..), Dialog(..), DomainControl, Failure(..), Filter(..), InputProblem(..), Load(..), Message(..), Model, Origin, Scope, Undo(..), Write(..), actorLabel, blockReady, fromResult)
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
  -- A new selection starts a new epoch: whatever the previous one still has in
  -- flight (lists, impact, writes) is dropped when it arrives.
  ProfileKnown (Right (Just profile)) ->
    load (switched model) { profile = Just profile }
  ProfileKnown (Right Nothing) ->
    noEffects (switched model) { profile = Nothing, domains = Failed (Failure "PROFILE_REQUIRED"), actors = Failed (Failure "PROFILE_REQUIRED") }
  ProfileKnown (Left failure) ->
    noEffects (switched model) { profile = Nothing, domains = Failed failure, actors = Failed failure }
  Reload -> load (model { dialog = Nothing, toast = Nothing, writing = false })
  DomainsLoaded scope result
    | current scope -> noEffects model { domains = fromResult result }
    | otherwise -> noEffects model
  ActorsLoaded scope result
    | current scope -> noEffects model { actors = fromResult result }
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
  ImpactLoaded scope domain result -> case model.dialog of
    Just (ConfirmBlock state) | current scope && state.domain == domain ->
      noEffects model { dialog = Just (ConfirmBlock state { impact = fromResult result }) }
    _ -> noEffects model
  RetryImpact -> case model.dialog, model.profile of
    Just (ConfirmBlock state), Just profile | not state.pending ->
      Tuple model { dialog = Just (ConfirmBlock state { impact = Loading, acknowledged = false }) }
        [ effect (Api.fetchImpact profile state.domain) (ImpactLoaded (scopeOf model profile) state.domain) ]
    _, _ -> noEffects model
  ToggleAcknowledged value -> case model.dialog of
    Just (ConfirmBlock state) -> noEffects model { dialog = Just (ConfirmBlock state { acknowledged = value }) }
    _ -> noEffects model
  CloseDialog
    | dialogPending model -> noEffects model
    | otherwise -> Tuple model { dialog = Nothing } [ focus (openerIds model) ]

  ConfirmMuteDomain -> case model.dialog of
    Just (ConfirmMute state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmMute state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain MUTE (map _.revision state.current))
            (Written (fromDialog profile) (if map _.mode state.current == Just BLOCK then DomainToMute else MuteDomain) state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  ConfirmBlockDomain -> case model.dialog of
    Just (ConfirmBlock state) | not state.pending, not model.writing, blockReady state, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmBlock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain BLOCK (map _.revision state.current))
            (Written (fromDialog profile) BlockDomain state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  MuteInstead -> case model.dialog of
    Just (ConfirmBlock state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmBlock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.domain MUTE (map _.revision state.current))
            (Written (fromDialog profile) MuteDomain state.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model
  UnmuteDomain control
    | model.writing -> noEffects model
    | Just profile <- model.profile ->
        Tuple model { writing = true }
          [ effect (Api.removeDomainControl profile control.domain control.revision)
              (Written (fromRow profile) UnmuteDomainRow control.domain <<< map DomainRemoved)
          ]
    | otherwise -> noEffects model
  OpenDomainUnblock opener control ->
    Tuple model { dialog = Just (ConfirmDomainUnblock { control, pending: false, failure: Nothing }), opener = Just opener }
      [ focus [ dialogFirstId ] ]
  ConfirmDomainUnblockNow -> case model.dialog of
    Just (ConfirmDomainUnblock state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmDomainUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.removeDomainControl profile state.control.domain state.control.revision)
            (Written (fromDialog profile) UnblockDomain state.control.domain <<< map DomainRemoved)
        ]
    _ -> noEffects model
  DomainUnblockToMute -> case model.dialog of
    Just (ConfirmDomainUnblock state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmDomainUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.setDomainControl profile state.control.domain MUTE (Just state.control.revision))
            (Written (fromDialog profile) DomainToMute state.control.domain <<< map DomainUpserted)
        ]
    _ -> noEffects model

  UnmuteActor policy
    | model.writing -> noEffects model
    | Just profile <- model.profile ->
        Tuple model { writing = true }
          [ effect (Api.removeActorPolicy profile policy.id MUTE)
              (Written (fromRow profile) (UnmuteActorRow policy.actorUrl) (actorLabel policy.actorUrl) <<< map ActorRemoved)
          ]
    | otherwise -> noEffects model
  OpenActorUnblock opener policy ->
    Tuple model { dialog = Just (ConfirmActorUnblock { policy, pending: false, failure: Nothing }), opener = Just opener }
      [ focus [ dialogFirstId ] ]
  ConfirmActorUnblockNow -> case model.dialog of
    Just (ConfirmActorUnblock state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmActorUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (Api.removeActorPolicy profile state.policy.id BLOCK)
            (Written (fromDialog profile) UnblockActor (actorLabel state.policy.actorUrl) <<< map ActorRemoved)
        ]
    _ -> noEffects model
  ActorUnblockToMute -> case model.dialog of
    Just (ConfirmActorUnblock state) | not state.pending, not model.writing, Just profile <- model.profile ->
      Tuple model { dialog = Just (ConfirmActorUnblock state { pending = true, failure = Nothing }), writing = true }
        [ effect (actorToMute profile state.policy) (Written (fromDialog profile) ActorToMute (actorLabel state.policy.actorUrl)) ]
    _ -> noEffects model

  -- A completion from an earlier Profile selection changes nothing here (its
  -- Profile was written; this page now shows another one).
  Written origin _ _ _ | not (current { profile: origin.profile, epoch: origin.epoch }) -> noEffects model
  Written origin write subject (Left failure) -> case model.dialog of
    Just dialog | origin.dialog && dialogPending model ->
      noEffects model { dialog = Just (withFailure failure dialog), writing = false }
    _ ->
      let
        Tuple next effects = showToast (model { writing = false }) origin { subject, rest: "", undo: Nothing, failure: Just failure }
      in
        Tuple next (effects <> reloadAfter model write)
  Written origin write subject (Right change) ->
    let
      -- Only the dialog that sent this write closes: a row action or "元に戻す"
      -- finishing later leaves a dialog opened meanwhile (and its input) alone.
      closes = origin.dialog && dialogPending model
      applied = applyChange change (model { writing = false, dialog = if closes then Nothing else model.dialog })
      refocus = if closes then [ focus (openerIds model) ] else []
      Tuple next effects = case notice write subject of
        Just toast -> showToast (resetFilter write applied) origin toast
        Nothing -> noEffects applied { toast = Nothing }
    in
      Tuple next (effects <> refocus <> reloadAfter model write)
  -- "元に戻す" restores into the Profile whose write the toast reports, and only
  -- while that selection is still the shown one.
  RunUndo -> case model.toast of
    Just { undo: Just undo, owner } | not model.writing && model.dialog == Nothing && current owner -> case undo of
      RestoreDomainMute domain ->
        Tuple model { writing = true, toast = Nothing }
          [ effect (Api.setDomainControl owner.profile domain MUTE Nothing) (Written (fromRow owner.profile) UndoWrite domain <<< map DomainUpserted) ]
      RestoreActorMute actorUrl ->
        Tuple model { writing = true, toast = Nothing }
          [ effect (Api.addActorPolicy owner.profile actorUrl MUTE) (Written (fromRow owner.profile) UndoWrite (actorLabel actorUrl) <<< map ActorAdded) ]
    _ -> noEffects model
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
  current :: Scope -> Boolean
  current scope = model.profile == Just scope.profile && model.epoch == scope.epoch

  fromDialog :: String -> Origin
  fromDialog profile = { profile, epoch: model.epoch, dialog: true }

  fromRow :: String -> Origin
  fromRow profile = { profile, epoch: model.epoch, dialog: false }

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
        [ effect (Api.fetchImpact profile domain) (ImpactLoaded (scopeOf model profile) domain), focus [ dialogFirstId ] ]
    Nothing -> noEffects model

scopeOf :: Model -> String -> Scope
scopeOf model profile = { profile, epoch: model.epoch }

-- | A new Profile selection: nothing of the previous one stays (dialog, toast,
-- | the in-flight write flag) and its late responses no longer match.
switched :: Model -> Model
switched model = model { profileKnown = true, dialog = Nothing, toast = Nothing, writing = false, epoch = model.epoch + 1 }

-- | Loads both lists for the shown Profile.
load :: Model -> Step
load model = case model.profile of
  Just profile ->
    Tuple model { domains = Loading, actors = Loading }
      [ effect (Api.fetchDomainControls profile) (DomainsLoaded (scopeOf model profile))
      , effect (Api.fetchActorPolicies profile) (ActorsLoaded (scopeOf model profile))
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
  ActorToMute, Just profile -> [ effect (Api.fetchActorPolicies profile) (ActorsLoaded (scopeOf model profile)) ]
  _, _ -> []

showToast :: Model -> Origin -> { subject :: String, rest :: String, undo :: Maybe Undo, failure :: Maybe Failure } -> Step
showToast model origin toast =
  let
    id = model.toastSeq + 1
    owner = { profile: origin.profile, epoch: origin.epoch }
  in
    Tuple model { toast = Just { id, owner, subject: toast.subject, rest: toast.rest, undo: toast.undo, failure: toast.failure, held: false }, toastSeq = id }
      [ dismissLater id ]

dismissLater :: Int -> Aff (Maybe Message)
dismissLater id = delay (Milliseconds toastSeconds) $> Just (DismissToast id)
