-- | Emoji as the UI handles them (D03): the identity + availability of the S3
-- | EmojiView (bff/schema.graphql Emoji) and the picker's Unicode catalogue.
-- |
-- | The catalogue (categories, names used for search and labels) is the set of the
-- | agreed mock (host intents/shuttlepub/features/quick-reaction-ui/mocks/index.html).
-- | Custom emoji come from the server (customEmojis, PROVISIONAL).
module App.Emoji
  ( EmojiKind(..)
  , UnavailableReason(..)
  , EmojiImageState(..)
  , EmojiUsage(..)
  , Emoji
  , Category
  , unicode
  , emojiKey
  , sameEmoji
  , emojiLabel
  , categories
  , customCategoryId
  , categoryEmojis
  , searchEmojis
  ) where

import Prelude

import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Array (concatMap, filter, find, head, nubByEq)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Show.Generic (genericShow)
import Data.String (Pattern(..), contains, split, toLower, trim)

data EmojiKind = UnicodeEmoji | CustomEmoji

derive instance Generic EmojiKind _
derive instance Eq EmojiKind

instance Show EmojiKind where
  show = genericShow

instance EncodeJson EmojiKind where
  encodeJson = genericEncodeJson

instance DecodeJson EmojiKind where
  decodeJson = genericDecodeJson

data UnavailableReason = Deleted | Disabled

derive instance Generic UnavailableReason _
derive instance Eq UnavailableReason

instance Show UnavailableReason where
  show = genericShow

instance EncodeJson UnavailableReason where
  encodeJson = genericEncodeJson

instance DecodeJson UnavailableReason where
  decodeJson = genericDecodeJson

-- | Custom emoji only: whether the image is held (PRESENT goes with imageUrl; MISSING means
-- | show :shortcode:).
data EmojiImageState = ImagePresent | ImageMissing

derive instance Generic EmojiImageState _
derive instance Eq EmojiImageState

instance Show EmojiImageState where
  show = genericShow

instance EncodeJson EmojiImageState where
  encodeJson = genericEncodeJson

instance DecodeJson EmojiImageState where
  decodeJson = genericDecodeJson

-- | Custom emoji only (Nothing for Unicode): ExistingReactionOnly is an external emoji,
-- | usable only as an existing reaction chip (never a favourite).
data EmojiUsage = Anywhere | ExistingReactionOnly

derive instance Generic EmojiUsage _
derive instance Eq EmojiUsage

instance Show EmojiUsage where
  show = genericShow

instance EncodeJson EmojiUsage where
  encodeJson = genericEncodeJson

instance DecodeJson EmojiUsage where
  decodeJson = genericDecodeJson

-- | value: the Unicode sequence, or the custom emoji's stable id. origin: the originating
-- | domain of an external custom emoji (Nothing for Unicode and this server's own emoji).
type Emoji =
  { kind :: EmojiKind
  , value :: String
  , shortcode :: Maybe String
  , imageUrl :: Maybe String
  , available :: Boolean
  , unavailableReason :: Maybe UnavailableReason
  , origin :: Maybe String
  , imageState :: Maybe EmojiImageState
  , usage :: Maybe EmojiUsage
  }

unicode :: String -> Emoji
unicode value = { kind: UnicodeEmoji, value, shortcode: Nothing, imageUrl: Nothing, available: true, unavailableReason: Nothing, origin: Nothing, imageState: Nothing, usage: Nothing }

-- | Identity (the contract compares EmojiRef as JSON values).
emojiKey :: Emoji -> String
emojiKey emoji = (if emoji.kind == UnicodeEmoji then "u:" else "c:") <> emoji.value

sameEmoji :: Emoji -> Emoji -> Boolean
sameEmoji a b = emojiKey a == emojiKey b

type Entry = { char :: String, names :: String }

type Category = { id :: String, label :: String, icon :: String }

-- | Name for screen readers and tooltips: the first catalogue name, or :shortcode:.
emojiLabel :: Emoji -> String
emojiLabel emoji = case emoji.kind of
  CustomEmoji -> ":" <> fromMaybe emoji.value emoji.shortcode <> ":"
  UnicodeEmoji -> case find (\entry -> entry.char == emoji.value) allEntries of
    Just entry -> fromMaybe emoji.value (head (split (Pattern " ") entry.names))
    Nothing -> emoji.value

customCategoryId :: String
customCategoryId = "custom"

categories :: Array Category
categories =
  [ { id: "face", label: "顔", icon: "😀" }
  , { id: "hand", label: "手・人", icon: "👍" }
  , { id: "nature", label: "動物・自然", icon: "🐱" }
  , { id: "food", label: "食べ物", icon: "🍣" }
  , { id: "symbol", label: "記号・お祝い", icon: "🎉" }
  , { id: customCategoryId, label: "このサーバーのカスタム絵文字", icon: "✨" }
  ]

catalogue :: Array { category :: String, entries :: Array Entry }
catalogue =
  [ { category: "face"
    , entries:
        [ e "😀" "にっこり smile"
        , e "😂" "うれし泣き 笑 joy"
        , e "🥹" "うるうる 感動"
        , e "😊" "ほほえみ smile"
        , e "😍" "ハート目 好き love"
        , e "🤔" "かんがえる think"
        , e "😮" "びっくり wow"
        , e "😢" "なみだ かなしい cry"
        , e "😡" "おこ angry"
        , e "🥳" "パーティ party"
        , e "😴" "ねむい sleep"
        , e "🤯" "衝撃 mindblown"
        , e "😎" "サングラス cool"
        , e "🫠" "とける melt"
        , e "😇" "天使 angel"
        , e "🙃" "さかさ upside"
        ]
    }
  , { category: "hand"
    , entries:
        [ e "👍" "いいね good thumbsup"
        , e "👎" "よくない bad"
        , e "👏" "拍手 clap"
        , e "🙏" "ありがとう おねがい pray"
        , e "🙌" "ばんざい raise"
        , e "👀" "みてる eyes"
        , e "💪" "がんばる muscle"
        , e "🫶" "ハート手 love"
        , e "✌️" "ピース peace"
        , e "👌" "オーケー ok"
        , e "🤝" "握手 handshake"
        , e "👋" "やあ wave"
        ]
    }
  , { category: "nature"
    , entries:
        [ e "🐱" "ねこ cat"
        , e "🐶" "いぬ dog"
        , e "🦊" "きつね fox"
        , e "🐧" "ペンギン penguin"
        , e "🐢" "かめ turtle"
        , e "🦀" "かに crab"
        , e "🐳" "くじら whale"
        , e "🌸" "さくら sakura"
        , e "🌙" "つき moon"
        , e "☀️" "たいよう sun"
        , e "🌈" "にじ rainbow"
        , e "🍀" "クローバー clover"
        ]
    }
  , { category: "food"
    , entries:
        [ e "🍣" "すし sushi"
        , e "🍜" "ラーメン ramen"
        , e "🍙" "おにぎり onigiri"
        , e "☕" "コーヒー coffee"
        , e "🍵" "おちゃ tea"
        , e "🍰" "ケーキ cake"
        , e "🍺" "ビール beer"
        , e "🍓" "いちご strawberry"
        , e "🍕" "ピザ pizza"
        , e "🍩" "ドーナツ donut"
        ]
    }
  , { category: "symbol"
    , entries:
        [ e "🎉" "おめでとう クラッカー party"
        , e "✨" "キラキラ sparkles"
        , e "🔥" "炎 アツい fire"
        , e "❤️" "ハート heart"
        , e "💜" "むらさきハート heart"
        , e "⭐" "ほし star"
        , e "🚀" "ロケット rocket"
        , e "✅" "チェック check"
        , e "💯" "100点 hundred"
        , e "‼️" "びっくり"
        , e "❓" "はてな question"
        , e "💤" "zzz sleep"
        ]
    }
  ]
  where
  e char names = { char, names }

allEntries :: Array Entry
allEntries = concatMap _.entries catalogue

-- | The grid of one category. Custom emoji: the server's available ones.
categoryEmojis :: Array Emoji -> String -> Array Emoji
categoryEmojis custom category
  | category == customCategoryId = filter _.available custom
  | otherwise = case find (\group -> group.category == category) catalogue of
      Just group -> map (unicode <<< _.char) group.entries
      Nothing -> []

-- | Search (ui-spec P4: the favourites row is hidden meanwhile) over names, the
-- | character itself and custom shortcodes. Only usable emoji are offered.
searchEmojis :: Array Emoji -> String -> Array Emoji
searchEmojis custom raw =
  nubByEq sameEmoji (map (unicode <<< _.char) (filter matchesEntry allEntries) <> filter matchesCustom (filter _.available custom))
  where
  query = toLower (trim raw)
  hit text = query /= "" && contains (Pattern query) (toLower text)
  matchesEntry entry = hit entry.names || entry.char == trim raw
  matchesCustom emoji = hit emoji.value || hit (fromMaybe "" emoji.shortcode)
