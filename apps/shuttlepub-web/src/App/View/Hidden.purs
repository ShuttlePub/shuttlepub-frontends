-- | D08 second stage (personal-domain-controls-ui ui-spec v5 3-x): how posts of a muted /
-- | blocked domain are shown when opened directly. The data follows S8: a hidden post
-- | carries only its control (kind + domain + revision), so the hidden card shows exactly
-- | that, whether the post itself or the post it quotes is the controlled one (S8 does
-- | not say which). [この投稿だけ表示] / [表示] / [投稿を表示] reveal for this page only
-- | (S8 single-note reveal); [隠す] drops it. No explanation text (ui-spec 引き算).
module App.View.Hidden
  ( hiddenCard
  , revealedBar
  , restrictionNotice
  , hiddenTitle
  , sourceLine
  , viewBody
  , revealButtonId
  , hideButtonId
  ) where

import Prelude

import App.Api.Error as Error
import App.Message (Message(..))
import App.Model (Model)
import App.Post (Control, PostView)
import App.View.Common (attr, emptySlot, icon, testId)
import App.View.PostCard (PostCardMode, controlLabel, postCardWith)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.ContentRestriction (ContentRestriction(..))
import Generated.Schema.Gql.Enum.HiddenCause (HiddenCause(..))
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))

revealButtonId :: String -> String
revealButtonId key = "sp-reveal-" <> key

hideButtonId :: String -> String
hideButtonId key = "sp-hide-" <> key

modeIcon :: PolicyMode -> String
modeIcon = case _ of
  MUTE -> "eyeoff"
  BLOCK -> "block"

-- | The card's one sentence (ui-spec 3-1 / 3-4): DIRECT, the post's own domain is the
-- | controlled one; QUOTE, the post quotes a note of the controlled domain.
hiddenTitle :: HiddenCause -> PolicyMode -> String
hiddenTitle cause mode = case cause of
  DIRECT -> controlLabel mode <> "中のドメインの投稿です"
  QUOTE -> controlLabel mode <> "中のドメインの投稿を引用しています"

-- | The domain line under it: for a quote it names the quoted source ("引用元: <domain>",
-- | the control's domain, ui-spec 3-4); otherwise the domain alone. Nothing of the quoted
-- | post (text, author) is known before the reveal.
sourceLine :: HiddenCause -> String -> String
sourceLine cause domain = case cause of
  DIRECT -> domain
  QUOTE -> "引用元: " <> domain

-- | ui-spec 3-1 / 3-4 / 3-6: kind and domain only (a quote also says it is one), and one
-- | button. key identifies the reveal (a post id, or "user" for a person's posts); label
-- | is the button text.
hiddenCard :: Model -> { key :: String, cause :: HiddenCause, label :: String, control :: Control, reveal :: Message, pending :: Boolean, error :: Maybe Error.ApiError } -> Html Message
hiddenCard _ card = HE.section
  [ HA.class' "sp-hidden-card"
  , attr "aria-labelledby" titleId
  , testId "hidden-post"
  , attr "data-mode" (if card.control.mode == BLOCK then "block" else "mute")
  , attr "data-domain" card.control.domain
  , attr "data-cause" (causeName card.cause)
  ]
  [ HE.span [ HA.class' "sp-hidden-icon" ] [ icon (modeIcon card.control.mode) ]
  , HE.h2 [ HA.id titleId, HA.class' "sp-hidden-title" ] [ HE.text (hiddenTitle card.cause card.control.mode) ]
  , HE.p [ HA.class' "sp-mono sp-hidden-domain", testId "hidden-source" ] [ HE.text (sourceLine card.cause card.control.domain) ]
  , HE.button
      [ HA.type' "button"
      , HA.id (revealButtonId card.key)
      , HA.class' "sp-hidden-reveal"
      , HA.disabled card.pending
      , HA.onClick card.reveal
      ]
      [ HE.text card.label ]
  , case card.error of
      Just error -> HE.p [ HA.class' "sp-state sp-state-error", attr "role" "alert", attr "data-error" (Error.tag error) ]
        [ HE.text ("表示できませんでした（" <> Error.describe error <> "）") ]
      Nothing -> emptySlot
  ]
  where
  titleId = "sp-hidden-title-" <> card.key

causeName :: HiddenCause -> String
causeName = case _ of
  DIRECT -> "direct"
  QUOTE -> "quote"

-- | ui-spec 3-2: while revealed, the kind and domain stay visible above it with [隠す].
revealedBar :: { key :: String, control :: Control, hide :: Message } -> Html Message
revealedBar bar = HE.div [ HA.class' "sp-revealed-bar", testId "revealed-bar", attr "data-domain" bar.control.domain ]
  [ icon (modeIcon bar.control.mode)
  , HE.span [ HA.class' "sp-grow" ]
      [ HE.span [ HA.class' "sp-mono" ] [ HE.text bar.control.domain ]
      , HE.text (" · " <> controlLabel bar.control.mode <> "中")
      ]
  , HE.button [ HA.type' "button", HA.id (hideButtonId bar.key), HA.class' "sp-text-btn", HA.onClick bar.hide ] [ HE.text "隠す" ]
  ]

-- | An independent gate (S8 ContentRestriction) a reveal never clears: no content at all.
restrictionNotice :: ContentRestriction -> Html Message
restrictionNotice restriction = HE.p [ HA.class' "sp-restricted", testId "restricted-post", attr "data-reason" reason ]
  [ icon "warn", HE.span_ [ HE.text text ] ]
  where
  Tuple reason text = case restriction of
    CW -> Tuple "cw" "閲覧注意の投稿です"
    SENSITIVE -> Tuple "sensitive" "センシティブな投稿です"
    DELETED -> Tuple "deleted" "削除された投稿です"
    VISIBILITY -> Tuple "visibility" "この投稿を表示する権限がありません"

-- | A visible post (with its S8 operations) or its gate.
viewBody :: Model -> PostCardMode -> PostView -> Html Message
viewBody model mode view = case view.post, view.restriction of
  Just post, _ -> postCardWith model mode view.operations post
  Nothing, Just restriction -> restrictionNotice restriction
  _, _ -> emptySlot
