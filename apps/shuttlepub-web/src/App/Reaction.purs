-- | Quick reaction (D03) state and its pure rules. The views are in
-- | App.Extension.Reaction, the update in Client.Reaction.
-- |
-- | State machine of one post for the acting Profile (1 Profile, 1 post, 1 reaction):
-- |   not reacted --(pick in the picker / tap someone's chip, C3)--> reacted
-- |   reacted --(tap my chip, C1)--> not reacted (+ undo toast, C2)
-- | There is no direct replacement: changing means removing, then picking again.
-- | Removal is sent when the undo toast goes away (D03 q09), or at once on navigation.
module App.Reaction
  ( Reactor
  , ReactionGroup
  , PostReactions
  , QuickSettings
  , PostRef
  , PickerTarget(..)
  , PickerState
  , ToastKind(..)
  , Toast
  , PendingRemoval
  , SettingsProblem
  , DetailFilter(..)
  , ReactionMsg(..)
  , Chip
  , ReactorRow
  , maxFavorites
  , maxChips
  , postReactionsFor
  , chipsOf
  , totalCount
  , reactorRows
  , tooltipOf
  , moveItem
  , removeAt
  , replaceAt
  ) where

import Prelude

import App.Api.Error (ApiError)
import App.Emoji (Emoji, emojiKey, sameEmoji)
import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Array (deleteAt, filter, find, foldl, index, insertAt, length, partition, sortBy, take, updateAt)
import Data.Array as Array
import Data.Either (Either)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Data.Show.Generic (genericShow)
import Data.String (joinWith)

-- | PROVISIONAL (bff/rest/reactions.ts): someone who reacted.
type Reactor = { id :: String, handle :: String, displayName :: String }

-- | PROVISIONAL: other people's reactions with one emoji (the acting Profile's excluded).
type ReactionGroup = { emoji :: Emoji, count :: Int, reactors :: Array Reactor }

-- | Reactions on one Note for the acting Profile: mine (S3) and other people's.
type PostReactions = { noteId :: String, mine :: Maybe Emoji, others :: Array ReactionGroup }

-- | S3 QuickReactionSettings of the acting Profile (revision 0 = never saved).
type QuickSettings = { profileId :: String, revision :: Int, favorites :: Array Emoji }

type PostRef = { postId :: String, noteId :: String }

-- | What a pick does: react to a post, or add / replace a favourite (settings, S6 / S4).
data PickerTarget = ReactTo PostRef | AddFavorite | ReplaceFavorite Int

derive instance Generic PickerTarget _
derive instance Eq PickerTarget

instance Show PickerTarget where
  show = genericShow

instance EncodeJson PickerTarget where
  encodeJson = genericEncodeJson

instance DecodeJson PickerTarget where
  decodeJson = genericDecodeJson

-- | opener: id of the element focus returns to when the picker closes without a pick.
type PickerState = { target :: PickerTarget, query :: String, category :: String, opener :: String }

-- | The reaction removed by the user, not sent yet (D03 q09: sent when the undo
-- | toast goes away, or when leaving the screen; undo sends nothing).
type PendingRemoval = { profileId :: String, post :: PostRef, emoji :: Emoji }

data ToastKind
  -- | C2: 「取り消しました／元に戻す」
  = UndoRemoval PendingRemoval
  -- | S2: 「削除しました／元に戻す」 (index, emoji)
  | UndoFavoriteRemoval Int Emoji
  -- | P2: 「利用できません／入れ替える」
  | FavoriteUnavailable Emoji
  -- | A failure of a reaction request, shown as such.
  | ReactionFailed String ApiError

derive instance Generic ToastKind _
derive instance Eq ToastKind

instance Show ToastKind where
  show = genericShow

instance EncodeJson ToastKind where
  encodeJson = genericEncodeJson

instance DecodeJson ToastKind where
  decodeJson = genericDecodeJson

-- | armed: generation of the running expiry timer; held while hovered, touched or
-- | focused (実装上の注意 3).
type Toast = { id :: Int, kind :: ToastKind, held :: Boolean, armed :: Int }

-- | A failed settings save: what failed and the list the user asked for (再試行 sends it).
type SettingsProblem = { error :: ApiError, retry :: Maybe (Array Emoji) }

-- | Post detail reaction list (D1): everyone, one emoji, or closed.
data DetailFilter = AllReactors | OnlyEmoji String | ListClosed

derive instance Generic DetailFilter _
derive instance Eq DetailFilter

instance Show DetailFilter where
  show = genericShow

instance EncodeJson DetailFilter where
  encodeJson = genericEncodeJson

instance DecodeJson DetailFilter where
  decodeJson = genericDecodeJson

data ReactionMsg
  = SettingsLoaded String (Either ApiError QuickSettings)
  | PostReactionsLoaded String (Either ApiError (Array PostReactions))
  | CustomEmojisLoaded (Either ApiError (Array Emoji))
  | OpenPicker PickerTarget String
  | ClosePicker
  | PickerSearch String
  | PickerCategory String
  | Pick Emoji
  | PickUnavailableFavorite Emoji
  | ReactWithChip PostRef Emoji
  | RemoveMine PostRef
  | ReactionSaved String PostRef (Maybe Emoji) (Either ApiError (Maybe Emoji))
  | RemovalSent PendingRemoval (Either ApiError Unit)
  | ToastExpired Int Int
  | ToastHold Boolean
  | ToastUndo
  | ToastAction
  | ToggleChipMenu Int
  | CloseChipMenu
  | MoveFavorite Int Int
  | RemoveFavorite Int
  | StartReplaceFavorite Int
  | SettingsSaved String QuickSettings (Array Emoji) (Either ApiError QuickSettings)
  | RetrySettings
  | DragStart Int
  | DragDrop Int
  | DragEnd
  | SelectDetailFilter DetailFilter

maxFavorites :: Int
maxFavorites = 5

-- | C4: the top 8 kinds, the rest behind 「+N」.
maxChips :: Int
maxChips = 8

postReactionsFor :: Array PostReactions -> String -> Maybe PostReactions
postReactionsFor posts noteId = find (\entry -> entry.noteId == noteId) posts

-- | mine: the acting Profile's own chip (always first, 実装上の注意 4).
type Chip = { emoji :: Emoji, count :: Int, mine :: Boolean, reactors :: Array Reactor }

-- | Chips sorted by count (most first, stable), then my reaction moved to the left
-- | end, also when nobody else used that emoji (実装上の注意 4).
chipsOf :: Maybe Reactor -> PostReactions -> Array Chip
chipsOf me reactions = case reactions.mine of
  Nothing -> sorted
  Just emoji ->
    let
      { yes, no } = partition (\chip -> sameEmoji chip.emoji emoji) sorted
      base = fromMaybe { emoji, count: 0, mine: true, reactors: [] } (Array.head yes)
      own = base { emoji = emoji, count = base.count + 1, mine = true, reactors = maybe' me <> base.reactors }
    in
      [ own ] <> no
  where
  sorted = sortBy (\a b -> compare b.count a.count)
    (map (\group -> { emoji: group.emoji, count: group.count, mine: false, reactors: group.reactors }) reactions.others)
  maybe' = case _ of
    Just reactor -> [ reactor ]
    Nothing -> []

totalCount :: PostReactions -> Int
totalCount reactions = foldl (\sum group -> sum + group.count) (if isJust reactions.mine then 1 else 0) reactions.others

type ReactorRow = { reactor :: Reactor, emoji :: Emoji, you :: Boolean }

-- | D1 / D3: the reactor list for a filter, the acting Profile first with 「あなた」.
reactorRows :: Maybe Reactor -> DetailFilter -> PostReactions -> Array ReactorRow
reactorRows me filterBy reactions = case filterBy of
  ListClosed -> []
  AllReactors -> rows
  OnlyEmoji key -> filter (\row -> emojiKey row.emoji == key) rows
  where
  rows = mineRow <> Array.concatMap (\group -> map (\reactor -> { reactor, emoji: group.emoji, you: false }) group.reactors) reactions.others
  mineRow = case me, reactions.mine of
    Just reactor, Just emoji -> [ { reactor, emoji, you: true } ]
    _, _ -> []

-- | D1: a few names on the TL (tooltip); 「あなた」 for the acting Profile.
tooltipOf :: Chip -> String
tooltipOf chip =
  joinWith "、" (map nameOf (take 3 chip.reactors))
    <> if length chip.reactors > 3 then " ほか " <> show (length chip.reactors - 3) <> " 人" else ""
  where
  nameOf reactor = if chip.mine && Just reactor == Array.head chip.reactors then "あなた" else reactor.displayName

-- | Moves the item at `from` to `to` (S3: drag, 左へ／右へ).
moveItem :: forall a. Int -> Int -> Array a -> Array a
moveItem from to items = fromMaybe items do
  item <- index items from
  rest <- deleteAt from items
  insertAt to item rest

removeAt :: forall a. Int -> Array a -> Array a
removeAt at items = fromMaybe items (deleteAt at items)

replaceAt :: forall a. Int -> a -> Array a -> Array a
replaceAt at item items = fromMaybe items (updateAt at item items)
