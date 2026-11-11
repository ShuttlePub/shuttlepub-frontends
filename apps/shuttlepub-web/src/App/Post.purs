module App.Post
  ( Author
  , Post
  , TimelineTab(..)
  , Visibility(..)
  , allTimelineTabs
  , allVisibilities
  , timelineTabLabel
  , timelineTabValue
  , timelineTabFromValue
  , visibilityLabel
  , visibilityDescription
  , visibilityValue
  ) where

import Prelude

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Array (find)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe)
import Data.Show.Generic (genericShow)

-- | PROVISIONAL post shapes mirroring the app-owned SDL (bff/schema.graphql). The
-- | pinned OpenAPI has no timeline/post endpoint yet; reaction data (D03) lives in
-- | App.Reaction, keyed by noteId.
type Author =
  { id :: String
  , handle :: String
  , displayName :: String
  }

type Post =
  { id :: String
  -- The ShuttlePub Note (UUID) the quick reaction operations address.
  , noteId :: String
  , author :: Author
  , text :: String
  , createdAt :: String
  , replyCount :: Int
  , repostCount :: Int
  , repostedBy :: Maybe Author
  , inReplyToId :: Maybe String
  }

-- | Timeline tabs of the home screen (mock: ホーム / ローカル / 連合).
data TimelineTab = HomeTimeline | LocalTimeline | FederatedTimeline

derive instance Generic TimelineTab _
derive instance Eq TimelineTab

instance Show TimelineTab where
  show = genericShow

instance EncodeJson TimelineTab where
  encodeJson = genericEncodeJson

instance DecodeJson TimelineTab where
  decodeJson = genericDecodeJson

allTimelineTabs :: Array TimelineTab
allTimelineTabs = [ HomeTimeline, LocalTimeline, FederatedTimeline ]

timelineTabLabel :: TimelineTab -> String
timelineTabLabel = case _ of
  HomeTimeline -> "ホーム"
  LocalTimeline -> "ローカル"
  FederatedTimeline -> "連合"

timelineTabValue :: TimelineTab -> String
timelineTabValue = case _ of
  HomeTimeline -> "home"
  LocalTimeline -> "local"
  FederatedTimeline -> "federated"

timelineTabFromValue :: String -> Maybe TimelineTab
timelineTabFromValue value = find (\tab -> timelineTabValue tab == value) allTimelineTabs

-- | Compose visibility. PROVISIONAL: the four choices mirror Misskey and are not a
-- | decided ShuttlePub model (ui-spec 投稿フォーム / overview 境界).
data Visibility = Public | HomeOnly | FollowersOnly | Direct

derive instance Generic Visibility _
derive instance Eq Visibility

instance Show Visibility where
  show = genericShow

instance EncodeJson Visibility where
  encodeJson = genericEncodeJson

instance DecodeJson Visibility where
  decodeJson = genericDecodeJson

allVisibilities :: Array Visibility
allVisibilities = [ Public, HomeOnly, FollowersOnly, Direct ]

visibilityLabel :: Visibility -> String
visibilityLabel = case _ of
  Public -> "公開"
  HomeOnly -> "ホーム"
  FollowersOnly -> "フォロワー"
  Direct -> "ダイレクト"

visibilityDescription :: Visibility -> String
visibilityDescription = case _ of
  Public -> "すべての人に公開"
  HomeOnly -> "ホーム TL のみに公開"
  FollowersOnly -> "自分のフォロワーのみに公開"
  Direct -> "指定したユーザーのみに公開"

visibilityValue :: Visibility -> String
visibilityValue = case _ of
  Public -> "public"
  HomeOnly -> "home"
  FollowersOnly -> "followers"
  Direct -> "direct"
