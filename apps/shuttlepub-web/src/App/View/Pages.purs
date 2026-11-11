-- | Screen bodies inside the shell's content column.
module App.View.Pages
  ( home
  , postDetail
  , settings
  , placeholder
  , timelineTabId
  , detailTabId
  ) where

import Prelude

import App.Extension.Reaction as Reaction
import App.Message (Message(..))
import App.Model (DetailTab(..), Model, RemoteData(..), activeProfile)
import App.Post (TimelineTab, allTimelineTabs, timelineTabLabel, timelineTabValue)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, errorNote, icon, routeLink, stateNote, testId)
import App.View.PostCard (PostCardMode(..), postCard)
import App.View.Shell (isSignedIn)
import Data.Array (length, null)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

timelineTabId :: TimelineTab -> String
timelineTabId tab = "sp-tl-tab-" <> timelineTabValue tab

-- | Home timeline. No compose box on top (L2); the TL tabs stick under the header.
home :: Model -> Html Message
home model = HE.div [ HA.class' "sp-page sp-page-home" ]
  [ HE.h1 [ HA.class' "sp-visually-hidden" ] [ HE.text "ホーム" ]
  , HE.div
      [ HA.class' "sp-tl-tabs"
      , attr "role" "tablist"
      , attr "aria-label" "タイムライン"
      , attr "data-tablist" "timeline"
      ]
      (map tabButton allTimelineTabs)
  , HE.div
      [ HA.id "sp-tl-panel"
      , HA.class' "sp-tl-panel"
      , attr "role" "tabpanel"
      , attr "aria-labelledby" (timelineTabId model.timelineTab)
      ]
      [ case model.timeline of
          Loaded posts
            | null posts -> stateNote "timeline" "empty" "まだ投稿はありません"
            | otherwise -> HE.div [ HA.class' "sp-tl", testId "timeline", attr "data-state" "loaded" ]
                (map (postCard model InTimeline) posts)
          Failed error -> errorNote "timeline" "タイムラインを表示できません" error
          _ -> stateNote "timeline" "loading" "読み込み中…"
      ]
  ]
  where
  tabButton tab =
    let
      selected = tab == model.timelineTab
    in
      HE.button
        [ HA.type' "button"
        , HA.id (timelineTabId tab)
        , HA.class' "sp-tl-tab"
        , attr "role" "tab"
        , attr "aria-selected" (if selected then "true" else "false")
        , attr "aria-controls" "sp-tl-panel"
        , attr "data-tab-value" (timelineTabValue tab)
        , HA.tabindex (if selected then 0 else (-1))
        , HA.onClick (SelectTimelineTab tab)
        ]
        [ HE.text (timelineTabLabel tab) ]

detailTabId :: DetailTab -> String
detailTabId = case _ of
  RepliesTab -> "sp-detail-tab-replies"
  ReactionsTab -> "sp-detail-tab-reactions"

-- | Post detail (L4 target): the post, then 返信 / リアクション tabs (D1, default 返信).
postDetail :: Model -> Html Message
postDetail model = HE.div [ HA.class' "sp-page sp-page-detail" ]
  [ HE.div [ HA.class' "sp-detail-head" ]
      [ routeLink Home [ HA.class' "sp-icon-btn", attr "aria-label" "戻る", HA.title "戻る" ] [ icon "back" ]
      , HE.h1_ [ HE.text "投稿" ]
      ]
  , case model.detail of
      Loaded { post: Just post, replies } -> HE.div [ testId "post-detail", attr "data-state" "loaded" ]
        [ HE.div [ HA.class' "sp-tl sp-tl-focused" ] [ postCard model Focused post ]
        , HE.div
            [ HA.class' "sp-dtabs"
            , attr "role" "tablist"
            , attr "aria-label" "返信とリアクション"
            , attr "data-tablist" "detail"
            ]
            [ detailTab RepliesTab "返信" (Just (length replies))
            , detailTab ReactionsTab "リアクション" (Reaction.detailTabCount model post)
            ]
        , HE.div
            [ HA.id "sp-detail-panel"
            , HA.class' "sp-dpanel"
            , attr "role" "tabpanel"
            , attr "aria-labelledby" (detailTabId model.detailTab)
            ]
            [ case model.detailTab of
                RepliesTab
                  | null replies -> HE.p [ HA.class' "sp-dempty" ] [ HE.text "まだ返信はありません" ]
                  | otherwise -> HE.div [ HA.class' "sp-tl sp-tl-replies" ] (map (postCard model InTimeline) replies)
                ReactionsTab -> Reaction.detailPanel model post
            ]
        ]
      Loaded { post: Nothing } -> stateNote "post-detail" "missing" "投稿が見つかりません"
      Failed error -> errorNote "post-detail" "投稿を表示できません" error
      _ -> stateNote "post-detail" "loading" "読み込み中…"
  ]
  where
  detailTab tab label count =
    let
      selected = tab == model.detailTab
    in
      HE.button
        [ HA.type' "button"
        , HA.id (detailTabId tab)
        , HA.class' "sp-dtab"
        , attr "role" "tab"
        , attr "aria-selected" (if selected then "true" else "false")
        , attr "aria-controls" "sp-detail-panel"
        , attr "data-tab-value"
            ( case tab of
                RepliesTab -> "replies"
                ReactionsTab -> "reactions"
            )
        , HA.tabindex (if selected then 0 else (-1))
        , HA.onClick (SelectDetailTab tab)
        ]
        ( [ HE.text label ] <> case count of
            Just n -> [ HE.span [ HA.class' "sp-dtab-count" ] [ HE.text (show n) ] ]
            Nothing -> []
        )

-- | 設定 (L3 target). The Profile section is where S1 (常用絵文字) plugs in via
-- | App.Extension.Reaction.settingsProfileRows.
settings :: Model -> Html Message
settings model = HE.div [ HA.class' "sp-page sp-page-padded sp-page-settings" ]
  [ HE.h1 [ HA.class' "sp-page-title" ] [ HE.text "設定" ]
  , case activeProfile model of
      Just profile ->
        let
          rows = Reaction.settingsProfileRows model profile <> [ muteBlockRow ]
        in
          HE.section [ HA.class' "sp-section", attr "aria-label" "Profile の設定" ]
            [ HE.div [ HA.class' "sp-section-head" ]
                [ avatar AvatarTiny profile
                , HE.span [ HA.class' "sp-section-name" ] [ HE.text profile.displayName ]
                , HE.span [ HA.class' "sp-muted" ] [ HE.text ("@" <> profile.handle) ]
                ]
            , if null rows then HE.p [ HA.class' "sp-set-empty" ] [ HE.text "この Profile の設定項目はまだありません" ]
              else HE.div [ HA.class' "sp-set-list" ] rows
            ]
      Nothing -> emptySlot
  , if isSignedIn model then
      HE.section [ HA.class' "sp-section" ]
        [ HE.div [ HA.class' "sp-set-list" ]
            [ HE.button [ HA.type' "button", HA.class' "sp-set-row sp-danger", HA.onClick Logout ] [ HE.text "ログアウト" ] ]
        ]
    else emptySlot
  ]

-- | Entry to 設定 > ミュート・ブロック (D08, personal-domain-controls-web-ui). The
-- | settings apply to the selected Profile, so the row sits in its section.
muteBlockRow :: Html Message
muteBlockRow = routeLink MuteBlockDomains [ HA.class' "sp-set-row", testId "settings-mute-block" ] [ HE.text "ミュート・ブロック" ]

-- | Navigation targets whose screens belong to later units.
placeholder :: String -> Html Message
placeholder title = HE.div [ HA.class' "sp-page sp-page-padded" ]
  [ HE.h1 [ HA.class' "sp-page-title" ] [ HE.text title ]
  , HE.p [ HA.class' "sp-muted sp-placeholder", testId "placeholder" ] [ HE.text "この画面はまだ実装されていません。" ]
  ]
