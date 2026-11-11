-- | Modal compose form (ui-spec L2 / 投稿フォーム).
-- |
-- | Desktop: top-aligned modal, max 520px, dimmed backdrop. Mobile: full screen with
-- | a 48px header. Top row: close + avatar only. Bottom row: image / CW / emoji on the
-- | left, visibility icon (no text) + 「投稿」 at the right end. Visibility choices are
-- | PROVISIONAL (Misskey's four), see App.Post.
module App.View.Compose
  ( compose
  , composeDialogId
  , composeTextId
  , visibilityButtonId
  ) where

import Prelude

import App.Api.Error as Error
import App.Message (Message(..))
import App.Model (ComposeState, Model, activeProfile)
import App.Post (Visibility(..), allVisibilities, visibilityDescription, visibilityLabel)
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, icon, testId, visuallyHidden)
import Data.Maybe (Maybe(..))
import Data.String.Common (trim)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

composeDialogId :: String
composeDialogId = "sp-compose-dialog"

composeTextId :: String
composeTextId = "sp-compose-text"

visibilityButtonId :: String
visibilityButtonId = "sp-compose-visibility"

visibilityIcon :: Visibility -> String
visibilityIcon = case _ of
  Public -> "globe"
  HomeOnly -> "home"
  FollowersOnly -> "lock"
  Direct -> "mail"

compose :: Model -> Html Message
compose model = case model.compose of
  Nothing -> emptySlot
  Just state -> HE.div [ HA.class' "sp-compose-backdrop", HA.onClick CloseCompose ]
    [ HE.div
        [ HA.id composeDialogId
        , HA.class' "sp-compose"
        , attr "role" "dialog"
        , attr "aria-modal" "true"
        , attr "aria-label" "投稿"
        , testId "compose-dialog"
        , HA.onClick ComposeSurfaceClicked
        ]
        [ HE.div [ HA.class' "sp-compose-head" ]
            [ HE.button
                [ HA.type' "button", HA.class' "sp-icon-btn", HA.onClick CloseCompose, attr "aria-label" "閉じる", HA.title "閉じる" ]
                [ icon "close" ]
            , case activeProfile model of
                Just profile -> HE.span [ HA.class' "sp-compose-author", HA.title (profile.displayName <> " @" <> profile.handle) ]
                  [ avatar AvatarSmall profile, visuallyHidden (profile.displayName <> " として投稿") ]
                Nothing -> emptySlot
            ]
        , HE.textarea
            [ HA.id composeTextId
            , HA.class' "sp-compose-text"
            , HA.placeholder "いまどうしてる？"
            , attr "aria-label" "投稿内容"
            , HA.value state.text
            , HA.onInput ComposeInput
            ]
            []
        , case state.error of
            Just error -> HE.p
              [ HA.class' "sp-compose-error", attr "role" "alert", attr "data-error" (Error.tag error) ]
              [ HE.text ("投稿できませんでした（" <> Error.describe error <> "）") ]
            Nothing -> emptySlot
        , HE.div [ HA.class' "sp-compose-foot" ]
            [ toolButton "image" "画像を添付"
            , toolButton "eye" "内容を隠す（CW）"
            , toolButton "react" "絵文字"
            , HE.span [ HA.class' "sp-grow" ] []
            , HE.div [ HA.class' "sp-compose-send" ]
                [ visibilityControl state
                , HE.button
                    [ HA.type' "button"
                    , HA.class' "sp-btn sp-btn-primary"
                    , HA.onClick SubmitPost
                    , HA.disabled (trim state.text == "" || state.submitting)
                    , testId "compose-submit"
                    ]
                    [ HE.text (if state.submitting then "投稿中…" else "投稿") ]
                ]
            ]
        ]
    ]

-- | Attachment / CW / emoji have no backend yet: shown in place, marked unavailable.
toolButton :: String -> String -> Html Message
toolButton kind label = HE.button
  [ HA.type' "button"
  , HA.class' "sp-act sp-compose-tool"
  , attr "aria-label" label
  , attr "aria-disabled" "true"
  , HA.title (label <> "（未実装）")
  ]
  [ icon kind ]

visibilityControl :: ComposeState -> Html Message
visibilityControl state = HE.div [ HA.class' "sp-vis-wrap" ]
  [ HE.button
      [ HA.type' "button"
      , HA.id visibilityButtonId
      , HA.class' "sp-icon-btn sp-vis-btn"
      , HA.onClick ToggleVisibilityMenu
      , attr "aria-haspopup" "menu"
      , attr "aria-expanded" (if state.visibilityMenuOpen then "true" else "false")
      , attr "aria-label" ("公開範囲: " <> visibilityLabel state.visibility)
      , HA.title ("公開範囲: " <> visibilityLabel state.visibility)
      , testId "compose-visibility"
      ]
      [ icon (visibilityIcon state.visibility) ]
  , if state.visibilityMenuOpen then
      HE.div [ HA.class' "sp-vis-menu", attr "role" "menu", attr "aria-label" "公開範囲" ]
        (map item allVisibilities)
    else emptySlot
  ]
  where
  item visibility = HE.button
    [ HA.type' "button"
    , HA.class' "sp-vis-item"
    , attr "role" "menuitemradio"
    , attr "aria-checked" (if visibility == state.visibility then "true" else "false")
    , HA.onClick (SetVisibility visibility)
    ]
    [ icon (visibilityIcon visibility)
    , HE.span_
        [ HE.b_ [ HE.text (visibilityLabel visibility) ]
        , HE.small_ [ HE.text (visibilityDescription visibility) ]
        ]
    ]
