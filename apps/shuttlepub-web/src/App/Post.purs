module App.Post
  ( Author
  , Control
  , Hidden
  , ReactionChip
  , ReactionCounts
  , Operations
  , Post
  , PostView
  , Quoted(..)
  , UserPage
  , allowedOperations
  , quotedOf
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

import Data.Argonaut.Decode.Class (class DecodeJson, decodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson, encodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Array (find)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Newtype (class Newtype)
import Data.Show.Generic (genericShow)
import App.Emoji (Emoji)
import Generated.Schema.Gql.Enum.ContentRestriction (ContentRestriction)
import Generated.Schema.Gql.Enum.HiddenCause (HiddenCause)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode)

-- | PROVISIONAL post shapes mirroring the app-owned SDL (bff/schema.graphql). What a
-- | Profile sees of them follows the S8 contract (hidden / visible / restricted, blocked
-- | operations); reaction data (D03) lives in App.Reaction, keyed by noteId.
type Author =
  { id :: String
  , handle :: String
  , displayName :: String
  -- Canonical actor URL (what an individual mute/block names) and its host, the only
  -- domain whose mute/block applies to this person.
  , actorUrl :: String
  , domain :: String
  -- On this server: no domain mute/block is offered for it.
  , local :: Boolean
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
  , quoted :: Maybe Quoted
  }

-- | A Profile's domain control as S8 reports it on content (mode, exact domain, E8
-- | revision). It says nothing else about the item it hides.
type Control = { mode :: PolicyMode, domain :: String, revision :: Int }

-- | Why and by which control a post is hidden (S8 HiddenContent). DIRECT: its own author's
-- | domain is controlled; QUOTE: it quotes a note of a controlled domain and the control is
-- | the quoted source's. Specific to hidden posts: Control itself stays cause-free.
type Hidden = { cause :: HiddenCause, control :: Control }

-- | A chip of the note's reactions (S8 EmojiReactionCount): the emoji with its view data
-- | (origin, image state, usage) and how many reacted.
type ReactionChip = { emoji :: Emoji, count :: Int }

-- | S8 ReactionCounts of a visible note: accepted historical counts.
type ReactionCounts = { likes :: Int, emoji :: Array ReactionChip }

-- | A revealed quote's target (S8 EmbeddedNotePresentation): exactly one field is set.
-- | There is no hidden variant: a controlled target hides the whole quote (Hidden QUOTE).
newtype Quoted = Quoted { post :: Maybe Post, restriction :: Maybe ContentRestriction }

derive instance Newtype Quoted _
-- Written out (eta-expanded): Post contains Quoted, so derived instances would refer
-- to themselves before they are defined.
instance Eq Quoted where
  eq (Quoted a) (Quoted b) = a == b

instance Show Quoted where
  show (Quoted a) = "(Quoted " <> show a <> ")"

instance EncodeJson Quoted where
  encodeJson (Quoted a) = encodeJson a

instance DecodeJson Quoted where
  decodeJson json = Quoted <$> decodeJson json

quotedOf :: Post -> Maybe { post :: Maybe Post, restriction :: Maybe ContentRestriction }
quotedOf post = map (\(Quoted q) -> q) post.quoted

-- | S8 PostOperationAvailability: Nothing = not refused by a domain block, Just = the
-- | block that refuses it (the post's own author's; a reveal never clears it).
type Operations =
  { reply :: Maybe Control
  , quote :: Maybe Control
  , repost :: Maybe Control
  , like :: Maybe Control
  , emojiReaction :: Maybe Control
  }

allowedOperations :: Operations
allowedOperations = { reply: Nothing, quote: Nothing, repost: Nothing, like: Nothing, emojiReaction: Nothing }

-- | One post seen directly (S8 DirectNoteResponse): exactly one of post / hidden /
-- | restriction is set; operations accompany a visible or restricted post.
type PostView =
  { id :: String
  , post :: Maybe Post
  , hidden :: Maybe Hidden
  , restriction :: Maybe ContentRestriction
  , operations :: Maybe Operations
  , reactionCounts :: Maybe ReactionCounts
  }

-- | A person's page (ui-spec 3-6). posts is empty while hidden is set.
type UserPage =
  { author :: Author
  , bio :: String
  , control :: Maybe Control
  , hidden :: Maybe Control
  , posts :: Array PostView
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
