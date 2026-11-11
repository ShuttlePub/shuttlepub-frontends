-- | State of the "ミュート・ブロック" settings page (D08 / F8, host
-- | intents/shuttlepub/features/personal-domain-controls-ui/ui-spec.md 1-x / 2-x).
-- |
-- | The page lists the selected Profile's domain controls and individual
-- | mutes/blocks held by Emumet. Every request names the Profile the page is
-- | showing; the BFF refuses it if another Profile was selected meanwhile.
module App.MuteBlock.Types where

import Prelude

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Array (null)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Either (Either(..))
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Show.Generic (genericShow)
import Data.String (Pattern(..), stripPrefix)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode)

-- | Sub-pages of the settings page (ui-spec 1-2).
data Tab = AccountsTab | DomainsTab

derive instance Generic Tab _
derive instance Eq Tab
instance Show Tab where
  show = genericShow

instance EncodeJson Tab where
  encodeJson = genericEncodeJson

instance DecodeJson Tab where
  decodeJson = genericDecodeJson

-- | "すべて／ミュート／ブロック" (ui-spec 1-1).
data Filter = AllModes | OnlyMute | OnlyBlock

derive instance Generic Filter _
derive instance Eq Filter
instance Show Filter where
  show = genericShow

instance EncodeJson Filter where
  encodeJson = genericEncodeJson

instance DecodeJson Filter where
  decodeJson = genericDecodeJson

type DomainControl =
  { domain :: String
  , mode :: PolicyMode
  , revision :: Int
  , createdAt :: String
  }

-- | Emumet exposes only the canonical actor URL of an individual target.
type ActorPolicy =
  { id :: String
  , mode :: PolicyMode
  , actorUrl :: String
  , createdAt :: String
  }

-- | How an individual target is shown: Emumet gives no name, icon or acct, so
-- | the canonical actor URL without its scheme.
actorLabel :: String -> String
actorLabel url = case stripPrefix (Pattern "https://") url of
  Just rest -> rest
  Nothing -> case stripPrefix (Pattern "http://") url of
    Just rest -> rest
    Nothing -> url

-- | Follows that a block of one exact domain detaches (canonical actor URLs).
type Impact =
  { following :: Array String
  , followers :: Array String
  }

-- | A failed request, by the BFF's `extensions.code` (or NETWORK / DECODE).
newtype Failure = Failure String

derive instance Generic Failure _
derive instance Eq Failure
instance Show Failure where
  show = genericShow

instance EncodeJson Failure where
  encodeJson = genericEncodeJson

instance DecodeJson Failure where
  decodeJson = genericDecodeJson

data Load a = Idle | Loading | Failed Failure | Ready a

derive instance Generic (Load a) _
derive instance Eq a => Eq (Load a)
instance Show a => Show (Load a) where
  show = genericShow

instance EncodeJson a => EncodeJson (Load a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (Load a) where
  decodeJson = genericDecodeJson

fromResult :: forall a. Either Failure a -> Load a
fromResult = case _ of
  Left failure -> Failed failure
  Right value -> Ready value

-- | Why the typed domain was not accepted: refused by the normalizer (its error
-- | code), already set with the same mode, or the check itself failed.
data InputProblem = InputRefused String | AlreadySet PolicyMode | InputFailed Failure

derive instance Generic InputProblem _
derive instance Eq InputProblem
instance Show InputProblem where
  show = genericShow

instance EncodeJson InputProblem where
  encodeJson = genericEncodeJson

instance DecodeJson InputProblem where
  decodeJson = genericDecodeJson

type AddState = { input :: String, problem :: Maybe InputProblem, pending :: Boolean }

type MuteState =
  { domain :: String, current :: Maybe DomainControl, fromInput :: Boolean, pending :: Boolean, failure :: Maybe Failure }

type BlockState =
  { domain :: String
  , current :: Maybe DomainControl
  , fromInput :: Boolean
  , impact :: Load Impact
  , acknowledged :: Boolean
  , pending :: Boolean
  , failure :: Maybe Failure
  }

-- | ui-spec 2-2: the block button needs the acknowledgement only when the block
-- | detaches something, or when what it detaches could not be determined.
blockReady :: forall r. { impact :: Load Impact, acknowledged :: Boolean | r } -> Boolean
blockReady state = case state.impact of
  Ready impact -> state.acknowledged || null impact.following && null impact.followers
  Failed _ -> state.acknowledged
  _ -> false

type DomainUnblockState = { control :: DomainControl, pending :: Boolean, failure :: Maybe Failure }

type ActorUnblockState = { policy :: ActorPolicy, pending :: Boolean, failure :: Maybe Failure }

data Dialog
  = AddDomain AddState
  | ConfirmMute MuteState
  | ConfirmBlock BlockState
  | ConfirmDomainUnblock DomainUnblockState
  | ConfirmActorUnblock ActorUnblockState

derive instance Generic Dialog _
derive instance Eq Dialog
instance Show Dialog where
  show = genericShow

instance EncodeJson Dialog where
  encodeJson = genericEncodeJson

instance DecodeJson Dialog where
  decodeJson = genericDecodeJson

-- | Which write ran; decides the toast text and whether it offers "元に戻す".
data Write
  = MuteDomain
  | BlockDomain
  | UnmuteDomainRow
  | UnblockDomain
  | DomainToMute
  -- | The actor URL, so that "元に戻す" can mute it again.
  | UnmuteActorRow String
  | UnblockActor
  | ActorToMute
  | UndoWrite

derive instance Generic Write _
derive instance Eq Write
instance Show Write where
  show = genericShow

instance EncodeJson Write where
  encodeJson = genericEncodeJson

instance DecodeJson Write where
  decodeJson = genericDecodeJson

-- | How a successful write changes the lists.
data Change
  = DomainUpserted DomainControl
  | DomainRemoved String
  | ActorAdded ActorPolicy
  | ActorRemoved String
  | ActorSwapped String ActorPolicy

derive instance Generic Change _
derive instance Eq Change
instance Show Change where
  show = genericShow

instance EncodeJson Change where
  encodeJson = genericEncodeJson

instance DecodeJson Change where
  decodeJson = genericDecodeJson

-- | What "元に戻す" does after an immediate unmute (ui-spec 1-6).
data Undo = RestoreDomainMute String | RestoreActorMute String

derive instance Generic Undo _
derive instance Eq Undo
instance Show Undo where
  show = genericShow

instance EncodeJson Undo where
  encodeJson = genericEncodeJson

instance DecodeJson Undo where
  decodeJson = genericDecodeJson

-- | "<subject> <rest>" with an optional undo, or a failure (with reload when the
-- | lists may be stale). held: pointer/focus is on it, so it does not time out.
type Toast =
  { id :: Int
  , subject :: String
  , rest :: String
  , undo :: Maybe Undo
  , failure :: Maybe Failure
  , held :: Boolean
  }

type Model =
  { profile :: Maybe String
  , profileKnown :: Boolean
  , domains :: Load (Array DomainControl)
  , actors :: Load (Array ActorPolicy)
  , domainFilter :: Filter
  , actorFilter :: Filter
  , dialog :: Maybe Dialog
  , opener :: Maybe String
  , toast :: Maybe Toast
  , toastSeq :: Int
  , writing :: Boolean
  }

init :: Model
init =
  { profile: Nothing
  , profileKnown: false
  , domains: Idle
  , actors: Idle
  , domainFilter: AllModes
  , actorFilter: AllModes
  , dialog: Nothing
  , opener: Nothing
  , toast: Nothing
  , toastSeq: 0
  , writing: false
  }

data Message
  -- | The app learned which Profile is selected (Nothing: none), or failed to.
  = ProfileKnown (Either Failure (Maybe String))
  | Reload
  | DomainsLoaded String (Either Failure (Array DomainControl))
  | ActorsLoaded String (Either Failure (Array ActorPolicy))
  | SetDomainFilter Filter
  | SetActorFilter Filter
  -- | Switch sub-page; the app turns it into a navigation.
  | Go Tab
  -- | Opening a dialog remembers the element id that gets focus back on close.
  | OpenAdd String
  | AddInput String
  | SubmitAdd PolicyMode
  | AddChecked PolicyMode (Either Failure { domain :: Maybe String, error :: Maybe String })
  | ImpactLoaded String (Either Failure Impact)
  | ToggleAcknowledged Boolean
  | CloseDialog
  | ConfirmMuteDomain
  | ConfirmBlockDomain
  | MuteInstead
  | UnmuteDomain DomainControl
  | OpenDomainUnblock String DomainControl
  | ConfirmDomainUnblockNow
  | DomainUnblockToMute
  | UnmuteActor ActorPolicy
  | OpenActorUnblock String ActorPolicy
  | ConfirmActorUnblockNow
  | ActorUnblockToMute
  | Written Write String (Either Failure Change)
  | RunUndo
  | ToastHold Boolean
  | DismissToast Int
  -- | The selected Profile or the session changed under the page.
  | ReloadPage
  | NoOp
