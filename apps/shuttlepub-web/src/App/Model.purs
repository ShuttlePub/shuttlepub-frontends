module App.Model where

import Prelude

import App.Api.Error (ApiError)
import App.Emoji (Emoji)
import App.Post (Post, TimelineTab(..), Visibility(..))
import App.Profile (Profile, ProfileContext)
import App.Reaction (DetailFilter(..), PendingRemoval, PickerState, PostReactions, QuickSettings, SettingsProblem, Toast)
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

-- | Post detail screen data: Nothing when the post does not exist.
type PostDetailData =
  { post :: Maybe Post
  , replies :: Array Post
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
  , reaction :: ReactionModel
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
  , settingsProblem :: Maybe SettingsProblem
  , posts :: Array PostReactions
  , postsError :: Maybe ApiError
  -- Notes with a PUT or DELETE in flight and its request id: one request per Note
  -- at a time (double-submit guard; a DELETE and a later PUT never overlap).
  , inFlight :: Array { noteId :: String, request :: Int }
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
  , settingsProblem: Nothing
  , posts: []
  , postsError: Nothing
  , inFlight: []
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
  , reaction: initialReactionModel
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
