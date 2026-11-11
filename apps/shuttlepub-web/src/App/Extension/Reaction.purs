-- | Extension points for the quick-reaction UI (D03, unit quick-reaction-web-ui / F3).
-- |
-- | The layout (F0) owns where reactions appear; F3 owns what they are. Every function
-- | here is called by the layout at a fixed place and currently renders the
-- | reaction-free baseline. F3 replaces the bodies (and adds its own Model fields /
-- | Message constructors / SDL fields) without moving layout code:
-- |
-- | - summary            post card, between the body and the action row (C1/C3/C4 chips)
-- | - actionButton       the third cell of the action row. The cell (.sp-react-slot)
-- |                      keeps its 32px (mobile 36px) width even when this renders
-- |                      emptySlot, so hiding the button while reacted does not move
-- |                      the other actions (ui-spec 投稿カードのアクション行).
-- |                      Keep the id `reactionButtonId post` so focus can return to it.
-- | - detailTabCount     the count on the post detail「リアクション」tab (D1)
-- | - detailPanel        contents of the「リアクション」tab panel (D1/D3)
-- | - settingsProfileRows rows of 設定 > Profile (S1: 常用絵文字)
-- | - overlay            rendered last in the shell: picker bottom sheet / toasts (P5, C2)
module App.Extension.Reaction
  ( summary
  , actionButton
  , reactionButtonId
  , detailTabCount
  , detailPanel
  , settingsProfileRows
  , overlay
  ) where

import Prelude

import App.Message (Message)
import App.Model (Model)
import App.Post (Post)
import App.Profile (Profile)
import App.View.Common (attr, emptySlot, icon)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

summary :: Model -> Post -> Html Message
summary _ _ = emptySlot

reactionButtonId :: Post -> String
reactionButtonId post = "react-" <> post.id

-- | Baseline: the reaction button in place but unavailable (no reaction API yet).
actionButton :: Model -> Post -> Html Message
actionButton _ post = HE.button
  [ HA.type' "button"
  , HA.id (reactionButtonId post)
  , HA.class' "sp-act"
  , attr "aria-label" "リアクション"
  , attr "aria-disabled" "true"
  , HA.title "リアクション（未実装）"
  ]
  [ icon "react" ]

detailTabCount :: Model -> Post -> Maybe Int
detailTabCount _ _ = Nothing

detailPanel :: Model -> Post -> Html Message
detailPanel _ _ = HE.p [ HA.class' "sp-dempty" ] [ HE.text "リアクションの一覧はまだ表示できません" ]

settingsProfileRows :: Model -> Profile -> Array (Html Message)
settingsProfileRows _ _ = []

overlay :: Model -> Html Message
overlay _ = emptySlot
