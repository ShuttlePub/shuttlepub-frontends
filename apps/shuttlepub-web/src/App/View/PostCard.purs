-- | Post card skeleton (ui-spec 投稿カード / L4): author line, body, reaction slots and
-- | the evenly spaced four-cell action row (返信・リポスト・リアクション・その他).
module App.View.PostCard
  ( PostCardMode(..)
  , postCard
  ) where

import Prelude

import App.Dom (fullDateTime, relativeTime)
import App.Extension.Reaction as Reaction
import App.Message (Message(..))
import App.Model (Model)
import App.Post (Post)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, icon, onPlainClick, routeLink)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

-- | InTimeline: compact card linking to the detail (body click + time link, L4).
-- | Focused: the large card at the top of the post detail screen.
data PostCardMode = InTimeline | Focused

derive instance Eq PostCardMode

postCard :: Model -> PostCardMode -> Post -> Html Message
postCard model mode post = HE.article
  [ HA.class' ("sp-post" <> if focused then " sp-post-focused" else "")
  , attr "aria-label" (post.author.displayName <> " の投稿")
  , attr "data-post-id" post.id
  ]
  [ case post.repostedBy of
      Just reposter -> HE.div [ HA.class' "sp-post-ctx" ]
        [ icon "repost", HE.span_ [ HE.text (reposter.displayName <> " がリポスト") ] ]
      Nothing -> emptySlot
  , avatar (if focused then AvatarLarge else AvatarRegular) post.author
  , HE.div [ HA.class' "sp-post-main" ]
      [ HE.div [ HA.class' "sp-post-head" ]
          [ HE.span [ HA.class' "sp-post-name" ] [ HE.text post.author.displayName ]
          , HE.span [ HA.class' "sp-post-handle" ] [ HE.text ("@" <> post.author.handle) ]
          , if focused then emptySlot
            else routeLink (PostDetail post.id)
              [ HA.class' "sp-post-time", HA.title (fullDateTime post.createdAt) ]
              [ HE.time [ attr "datetime" post.createdAt ] [ HE.text (relativeTime model.now post.createdAt) ] ]
          ]
      , HE.div
          ( [ HA.class' ("sp-post-text" <> if focused then "" else " sp-post-text-link") ]
              <> if focused then [] else [ onPlainClick (Navigate (PostDetail post.id)) ]
          )
          [ HE.text post.text ]
      , if focused then HE.div [ HA.class' "sp-post-meta" ] [ HE.time [ attr "datetime" post.createdAt ] [ HE.text (fullDateTime post.createdAt) ] ]
        else emptySlot
      , Reaction.summary model post
      , HE.div [ HA.class' "sp-actions" ]
          [ countButton "reply" "返信" post.replyCount
          , countButton "repost" "リポスト" post.repostCount
          , HE.div [ HA.class' "sp-react-slot" ] [ Reaction.actionButton model post ]
          , HE.button
              [ HA.type' "button", HA.class' "sp-act", attr "aria-label" "その他", attr "aria-disabled" "true", HA.title "その他（未実装）" ]
              [ icon "more" ]
          ]
      ]
  ]
  where
  focused = mode == Focused

-- | Reply / repost have no API yet: present (layout) but marked unavailable.
countButton :: String -> String -> Int -> Html Message
countButton kind label count = HE.button
  [ HA.type' "button"
  , HA.class' "sp-act"
  , attr "aria-label" (if count > 0 then label <> " " <> show count else label)
  , attr "aria-disabled" "true"
  , HA.title (label <> "（未実装）")
  ]
  ([ icon kind ] <> if count > 0 then [ HE.span [ HA.class' "sp-act-count" ] [ HE.text (show count) ] ] else [])
