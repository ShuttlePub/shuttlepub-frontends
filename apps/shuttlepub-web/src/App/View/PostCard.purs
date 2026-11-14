-- | Post card skeleton (ui-spec 投稿カード / L4): author line, body, reaction slots and
-- | the evenly spaced four-cell action row (返信・リポスト・リアクション・その他).
-- |
-- | D08 (personal-domain-controls-ui ui-spec v5): the "…" cell opens the post menu
-- | (1-1 主導線: 〈@user〉/〈domain〉 をミュート・ブロック), operations a domain block refuses
-- | (S8 PostOperationAvailability) are locked and open the 4-1 sheet (3-3), and a quote
-- | shows its target as S8 presents it (a hidden target stays hidden, 3-4).
module App.View.PostCard
  ( PostCardMode(..)
  , postCard
  , postCardWith
  , postMenu
  , menuButtonId
  , controlLabel
  , shortHandle
  ) where

import Prelude

import App.Dom (fullDateTime, relativeTime)
import App.Extension.Reaction as Reaction
import App.Message (Message(..))
import App.Model (Model)
import App.MuteBlock.Types (Load(..))
import App.MuteBlock.Types as MuteBlock
import App.Post (Author, Control, Operations, Post, quotedOf)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, icon, onPlainClick, routeLink, testId)
import Data.Array (any, find)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), indexOf, take)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.ContentRestriction (ContentRestriction(..))
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))

-- | InTimeline: compact card linking to the detail (body click + time link, L4).
-- | Focused: the large card at the top of the post detail screen.
data PostCardMode = InTimeline | Focused

derive instance Eq PostCardMode

-- | A card whose operations no domain block refuses (timelines only carry such posts).
postCard :: Model -> PostCardMode -> Post -> Html Message
postCard model mode = postCardWith model mode Nothing

-- | operations: the S8 availability of a post seen directly (Nothing = none refused).
postCardWith :: Model -> PostCardMode -> Maybe Operations -> Post -> Html Message
postCardWith model mode operations post = HE.article
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
          [ routeLink (UserProfile post.author.handle) [ HA.class' "sp-post-name" ] [ HE.text post.author.displayName ]
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
      , quoteBox post
      , if focused then HE.div [ HA.class' "sp-post-meta" ] [ HE.time [ attr "datetime" post.createdAt ] [ HE.text (fullDateTime post.createdAt) ] ]
        else emptySlot
      -- Accepted reactions keep their counts (ui-spec 5-4); while a block refuses new
      -- ones the chips cannot be pressed (the locked button is the way in, 3-3).
      , case ops.emojiReaction of
          Just _ -> HE.div [ attr "inert" "", testId "reactions-locked" ] [ Reaction.summary model post ]
          Nothing -> Reaction.summary model post
      , HE.div [ HA.class' "sp-actions" ]
          [ case ops.reply of
              Just control -> lockedButton post "reply" "返信" post.replyCount control
              Nothing -> countButton "reply" "返信" post.replyCount
          , case ops.repost of
              Just control -> lockedButton post "repost" "リポスト" post.repostCount control
              Nothing -> countButton "repost" "リポスト" post.repostCount
          , HE.div [ HA.class' "sp-react-slot" ]
              [ case ops.emojiReaction of
                  Just control -> lockedButton post "react" "リアクション" 0 control
                  Nothing -> Reaction.actionButton model post
              ]
          , postMenu model post.id post.author
          ]
      ]
  ]
  where
  focused = mode == Focused
  ops = case operations of
    Just value -> value
    Nothing -> { reply: Nothing, quote: Nothing, repost: Nothing, like: Nothing, emojiReaction: Nothing }

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

-- | ui-spec 3-3 / 4-1: pressable, marked with a lock; opens "〈label〉できません".
lockedButton :: Post -> String -> String -> Int -> Control -> Html Message
lockedButton post kind label count control = HE.button
  [ HA.type' "button"
  , HA.id buttonId
  , HA.class' "sp-act sp-act-locked"
  , attr "aria-label" (label <> "（ブロック中）")
  , attr "aria-haspopup" "dialog"
  , attr "data-locked" kind
  , HA.onClick (MuteBlockMsg (MuteBlock.OpenBlockedSheet buttonId label control.domain control.revision))
  ]
  ( [ HE.span [ HA.class' "sp-lock-wrap" ] [ icon kind, HE.span [ HA.class' "sp-lock-badge" ] [ icon "lock" ] ] ]
      <> if count > 0 then [ HE.span [ HA.class' "sp-act-count" ] [ HE.text (show count) ] ] else []
  )
  where
  buttonId = "sp-locked-" <> kind <> "-" <> post.id

-- | ui-spec 3-4 (S8 EmbeddedNotePresentation): the quoted post or its gate. A quote of a
-- | controlled post never gets here: the whole quoting post is hidden (Hidden QUOTE).
quoteBox :: Post -> Html Message
quoteBox post = case quotedOf post of
  Nothing -> emptySlot
  Just quoted -> case quoted.post, quoted.restriction of
    Just target, _ -> routeLink (PostDetail target.id) [ HA.class' "sp-quote", testId "quote" ]
      [ HE.span [ HA.class' "sp-quote-head" ]
          [ HE.span [ HA.class' "sp-post-name" ] [ HE.text target.author.displayName ]
          , HE.span [ HA.class' "sp-post-handle" ] [ HE.text ("@" <> target.author.handle) ]
          ]
      , HE.span [ HA.class' "sp-quote-text" ] [ HE.text target.text ]
      ]
    _, Just restriction -> HE.div [ HA.class' "sp-quote sp-quote-hidden", testId "quote", attr "data-state" "restricted" ]
      [ HE.text (restrictionText restriction) ]
    _, _ -> emptySlot

restrictionText :: ContentRestriction -> String
restrictionText = case _ of
  CW -> "閲覧注意の投稿です"
  SENSITIVE -> "センシティブな投稿です"
  DELETED -> "削除された投稿です"
  VISIBILITY -> "表示できない投稿です"

controlLabel :: PolicyMode -> String
controlLabel = case _ of
  MUTE -> "ミュート"
  BLOCK -> "ブロック"

-- | "@mika" of "mika@misskey.example" (the menu names the person short, as the mock does).
shortHandle :: String -> String
shortHandle handle = "@" <> case indexOf (Pattern "@") handle of
  Just at -> take at handle
  Nothing -> handle

menuButtonId :: String -> String
menuButtonId key = "sp-more-" <> key

-- | The "…" cell and its menu (ui-spec 1-1 主導線, 4-2). Items are "対象＋動詞" only;
-- | each reflects the current setting of the shown Profile (mute → ミュートを解除,
-- | block → ブロックを解除…). This server's own domain is never offered.
postMenu :: Model -> String -> Author -> Html Message
postMenu model key author = HE.div [ HA.class' "sp-more-anchor" ]
  [ HE.button
      [ HA.type' "button"
      , HA.id opener
      , HA.class' "sp-act"
      , attr "aria-label" "その他"
      , attr "aria-haspopup" "menu"
      , attr "aria-expanded" (if open then "true" else "false")
      , HA.title "その他"
      , HA.onClick (if open then ClosePostMenu else OpenPostMenu key opener)
      ]
      [ icon "more" ]
  , if open then layer else emptySlot
  ]
  where
  opener = menuButtonId key
  open = map _.postId model.content.menu == Just key
  layer
    | model.isMobile = HE.div [ HA.class' "sp-sheet-backdrop", HA.onClick ClosePostMenu ]
        [ HE.div [ HA.class' "sp-sheet", attr "role" "dialog", attr "aria-modal" "true", attr "aria-label" "その他", HA.onClick NoOp ]
            [ HE.div [ HA.class' "sp-sheet-grip", attr "aria-hidden" "true" ] [], items ]
        ]
    | otherwise = HE.div_
        [ HE.div [ HA.class' "sp-menu-clickaway sp-post-menu-clickaway", HA.onClick ClosePostMenu ] []
        , HE.div [ HA.class' "sp-post-menu-popover", HA.onClick NoOp ] [ items ]
        ]
  user = shortHandle author.handle
  domain = author.domain
  domainControl = case model.muteBlock.domains of
    Ready list -> find (\control -> control.domain == domain) list
    _ -> Nothing
  actorMode mode = case model.muteBlock.actors of
    Ready list -> any (\policy -> policy.actorUrl == author.actorUrl && policy.mode == mode) list
    _ -> false
  item iconKind danger label message = HE.button
    [ HA.type' "button"
    , HA.class' ("sp-menu-item" <> if danger then " sp-danger" else "")
    , attr "role" "menuitem"
    , HA.onClick (MenuAction message)
    ]
    [ icon iconKind, HE.span [ HA.class' "sp-grow" ] label ]
  mono text = HE.span [ HA.class' "sp-mono" ] [ HE.text text ]
  items = HE.div [ HA.id "sp-post-menu", HA.class' "sp-menu", attr "role" "menu", attr "aria-label" "その他", testId "post-menu" ]
    ( [ if actorMode MUTE then item "eye" false [ HE.text (user <> " のミュートを解除") ] (MuteBlock.MenuUnmuteActor author.actorUrl)
        else item "eyeoff" false [ HE.text (user <> " をミュート") ] (MuteBlock.MenuMuteActor author.actorUrl user)
      , if actorMode BLOCK then item "block" false [ HE.text (user <> " のブロックを解除…") ] (MuteBlock.MenuUnblockActor opener author.actorUrl)
        else item "userx" false [ HE.text (user <> " をブロック") ] (MuteBlock.MenuBlockActor opener author.actorUrl user)
      ]
        <>
          if author.local then []
          else
            [ HE.hr' [ attr "role" "separator", HA.class' "sp-menu-sep" ] ]
              <> case map _.mode domainControl of
                Just MUTE ->
                  [ item "eye" false [ mono domain, HE.text " のミュートを解除" ] (MuteBlock.MenuUnmuteDomain domain)
                  , item "block" true [ mono domain, HE.text " をブロック" ] (MuteBlock.MenuBlockDomain opener domain)
                  ]
                Just BLOCK ->
                  [ item "block" false [ mono domain, HE.text " のブロックを解除…" ] (MuteBlock.MenuUnblockDomain opener domain) ]
                Nothing ->
                  [ item "eyeoff" false [ mono domain, HE.text " をミュート" ] (MuteBlock.MenuMuteDomain domain)
                  , item "block" true [ mono domain, HE.text " をブロック" ] (MuteBlock.MenuBlockDomain opener domain)
                  ]
    )
