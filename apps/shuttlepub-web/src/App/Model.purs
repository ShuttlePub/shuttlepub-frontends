module App.Model where

import Prelude

import App.Api.Error (ApiError)
import App.Emoji (Emoji)
import App.Post (Post, PostView, TimelineTab(..), UserPage, Visibility(..))
import App.Profile (Profile, ProfileContext)
import App.MuteBlock.Types as MuteBlock
import App.Reaction (DetailFilter(..), NoteWrite, PendingRemoval, PickerState, PostReactions, QuickSettings, SettingsProblem, Toast)
import App.Route (Route)
import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Either (Either(..))
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Show.Generic (genericShow)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)

data RemoteData a
  = NotAsked
  | Loading
  | Failed ApiError
  | Loaded a

derive instance Generic (RemoteData a) _
derive instance Eq a => Eq (RemoteData a)

instance Show a => Show (RemoteData a) where
  show = genericShow

instance EncodeJson a => EncodeJson (RemoteData a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (RemoteData a) where
  decodeJson = genericDecodeJson

fromEither :: forall a. Either ApiError a -> RemoteData a
fromEither = case _ of
  Left error -> Failed error
  Right value -> Loaded value

type ApiStatus =
  { apiVersion :: String
  }

-- | Post detail screen data (S8 direct views): view is Nothing when the post does not exist.
type PostDetailData =
  { view :: Maybe PostView
  , replies :: Array PostView
  }

-- | Tabs of the post detail screen (ui-spec D1: 返信 is the default).
data DetailTab = RepliesTab | ReactionsTab

derive instance Generic DetailTab _
derive instance Eq DetailTab

instance Show DetailTab where
  show = genericShow

instance EncodeJson DetailTab where
  encodeJson = genericEncodeJson

instance DecodeJson DetailTab where
  decodeJson = genericDecodeJson

-- | The modal compose form (ui-spec L2). opener is the id of the button that opened
-- | it; focus returns there when the form closes.
type ComposeState =
  { text :: String
  , visibility :: Visibility
  , visibilityMenuOpen :: Boolean
  , submitting :: Boolean
  , error :: Maybe ApiError
  , opener :: String
  }

-- | The Profile switcher (ui-spec L1). opener as for ComposeState.
type ProfileMenuState =
  { opener :: String
  , error :: Maybe ApiError
  }

-- | The post menu ("…", ui-spec 1-1 主導線) of one post card. opener is the button's id.
type PostMenuState = { postId :: String, opener :: String }

-- | Content shown on Home / post detail / a person's page (D08 second stage, S8).
-- |
-- | epoch is bumped whenever the route's content is (re)requested; an answer of another
-- | epoch is dropped. profile is the Profile context the content was requested for:
-- | content waits until the Profile context is known and is requested again when it
-- | changes, so one Profile's controls never decide what another Profile is shown.
-- | Reveals (S8 single-note reveal) are page-local: kept only while the page is shown,
-- | never stored or synced; leaving, reloading or [隠す] hides again. Every reveal
-- | request has its own id (revealSeq); only the request a target is waiting for is
-- | applied, so [隠す] (which forgets it) wins over an answer still on its way.
-- | controlsSeen is the Profile's domain-control list the shown content follows: when
-- | the list changes by any path (a write here, or a reload after a conflict), the
-- | content is asked for again.
type ContentState =
  { epoch :: Int
  , profile :: Maybe String
  , waiting :: Boolean
  , reveals :: Array PostView
  , revealSeq :: Int
  , revealing :: Array { id :: String, request :: Int }
  , revealError :: Maybe { id :: String, error :: ApiError }
  , repliesOpen :: Boolean
  , user :: RemoteData (Maybe UserPage)
  , userRevealed :: Maybe UserPage
  , userRevealing :: Maybe Int
  , userRevealError :: Maybe ApiError
  , controlsSeen :: Maybe (Array MuteBlock.DomainControl)
  , menu :: Maybe PostMenuState
  -- | Where focus returns if a menu action took its post away (opener id).
  , refocus :: Maybe String
  }

initialContent :: ContentState
initialContent =
  { epoch: 0
  , profile: Nothing
  , waiting: false
  , reveals: []
  , revealSeq: 0
  , revealing: []
  , revealError: Nothing
  , repliesOpen: false
  , user: NotAsked
  , userRevealed: Nothing
  , userRevealing: Nothing
  , userRevealError: Nothing
  , controlsSeen: Nothing
  , menu: Nothing
  , refocus: Nothing
  }

-- | Record encode/decode instances come from argonaut-codecs, so the Flame
-- | serialized state round-trips without hand-written instances.
-- |
-- | isMobile and now are client facts: SSR renders with false / 0.0 and the client
-- | fills them in on hydration. Nothing SSR renders depends on them (layout switches
-- | by CSS media query; times appear only with data that is fetched after hydration).
type Model =
  { route :: Maybe Route
  , isHydrated :: Boolean
  , isMobile :: Boolean
  , now :: Number
  , apiMode :: RemoteData ApiMode
  , apiStatus :: RemoteData ApiStatus
  , profileContext :: RemoteData ProfileContext
  , availableProfiles :: RemoteData (Array Profile)
  , timelineTab :: TimelineTab
  , timeline :: RemoteData (Array Post)
  , detail :: RemoteData PostDetailData
  , detailTab :: DetailTab
  , compose :: Maybe ComposeState
  , profileMenu :: Maybe ProfileMenuState
  , muteBlock :: MuteBlock.Model
  , content :: ContentState
  , reaction :: ReactionModel
  -- Transport lifetime is independent of the visible Profile/epoch.
  , reactionWrites :: ReactionWrites
  }

type ReactionWrites =
  { notes :: Array NoteWrite
  , versions :: Array { profileId :: String, noteId :: String, sequence :: Int }
  , settings :: Array { profileId :: String, epoch :: Int, request :: Int }
  }

-- | Quick reaction (D03, App.Reaction) for the acting Profile `profileId`. Everything
-- | here belongs to that Profile and is reset when the Profile changes.
type ReactionModel =
  { profileId :: Maybe String
  -- Profile context generation: bumped whenever the acting Profile changes (also
  -- A -> B -> A) or the page is restored; answers from another generation are dropped.
  , epoch :: Int
  -- Source of request ids (settings, per-Note reaction requests).
  , requestSeq :: Int
  -- The settings request whose answer is awaited (older answers are dropped).
  , settingsRequest :: Int
  , settings :: RemoteData QuickSettings
  , savingSettings :: Boolean
  , retryAfterLoad :: Boolean
  , restoring :: Boolean
  , settingsProblem :: Maybe SettingsProblem
  , posts :: Array PostReactions
  , postsError :: Maybe ApiError
  , pendingRemoval :: Maybe PendingRemoval
  , picker :: Maybe PickerState
  , chipMenu :: Maybe Int
  , dragFrom :: Maybe Int
  , toast :: Maybe Toast
  , toastSeq :: Int
  , detailFilter :: DetailFilter
  , customEmojis :: RemoteData (Array Emoji)
  }

initialReactionModel :: ReactionModel
initialReactionModel =
  { profileId: Nothing
  , epoch: 0
  , requestSeq: 0
  , settingsRequest: 0
  , settings: NotAsked
  , savingSettings: false
  , retryAfterLoad: false
  , restoring: false
  , settingsProblem: Nothing
  , posts: []
  , postsError: Nothing
  , pendingRemoval: Nothing
  , picker: Nothing
  , chipMenu: Nothing
  , dragFrom: Nothing
  , toast: Nothing
  , toastSeq: 0
  , detailFilter: AllReactors
  , customEmojis: NotAsked
  }

-- | Initial model used by SSR (and as the base for tests). Data is requested by
-- | the client after hydration, so SSR never claims to know it.
initialModel :: Maybe Route -> Model
initialModel route =
  { route
  , isHydrated: false
  , isMobile: false
  , now: 0.0
  , apiMode: NotAsked
  , apiStatus: NotAsked
  , profileContext: NotAsked
  , availableProfiles: NotAsked
  , timelineTab: HomeTimeline
  , timeline: NotAsked
  , detail: NotAsked
  , detailTab: RepliesTab
  , compose: Nothing
  , profileMenu: Nothing
  , muteBlock: MuteBlock.init
  , content: initialContent
  , reaction: initialReactionModel
  , reactionWrites: { notes: [], versions: [], settings: [] }
  }

emptyCompose :: String -> ComposeState
emptyCompose opener =
  { text: ""
  , visibility: Public
  , visibilityMenuOpen: false
  , submitting: false
  , error: Nothing
  , opener
  }

activeProfile :: Model -> Maybe Profile
activeProfile model = case model.profileContext of
  Loaded context -> context.activeProfile
  _ -> Nothing
