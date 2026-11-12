-- | Screen bodies inside the shell's content column.
module App.View.Pages
  ( home
  , postDetail
  , userPage
  , contentHeadingId
  , settings
  , placeholder
  , timelineTabId
  , detailTabId
  ) where

import Prelude

import App.Api.Error (ApiError)
import App.Api.Error as Error
import App.Extension.Reaction as Reaction
import App.Message (Message(..))
import App.Model (DetailTab(..), Model, RemoteData(..), activeProfile)
import App.MuteBlock.Types as MuteBlock
import App.Post (PostView, TimelineTab, allTimelineTabs, timelineTabLabel, timelineTabValue)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, errorNote, icon, routeLink, stateNote, testId)
import App.View.Hidden (hiddenCard, revealButtonId, revealedBar, viewBody)
import App.View.PostCard (PostCardMode(..), controlLabel, postCard, postMenu)
import App.View.Shell (isSignedIn)
import Data.Array (any, elem, filter, find, length, null)
import Data.Maybe (Maybe(..), fromMaybe, isJust, isNothing)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

-- | The h1 of Home / post / person: where focus goes when a menu's opener is gone
-- | (App.MuteBlock.Update.contentHeadingId).
contentHeadingId :: String
contentHeadingId = "sp-content-heading"

timelineTabId :: TimelineTab -> String
timelineTabId tab = "sp-tl-tab-" <> timelineTabValue tab

-- | Home timeline. No compose box on top (L2); the TL tabs stick under the header.
home :: Model -> Html Message
home model = HE.div [ HA.class' "sp-page sp-page-home" ]
  [ HE.h1 [ HA.id contentHeadingId, HA.tabindex (-1), HA.class' "sp-visually-hidden" ] [ HE.text "ホーム" ]
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
-- |
-- | D08 (ui-spec 3-1 … 3-5, S8 direct view): a post of a muted / blocked domain (or a
-- | quote of one) opens hidden; [この投稿だけ表示] reveals it for this page; replies of
-- | such domains fold into "非表示の返信 n 件" and are shown one by one.
postDetail :: Model -> Html Message
postDetail model = HE.div [ HA.class' "sp-page sp-page-detail" ]
  [ HE.div [ HA.class' "sp-detail-head" ]
      [ routeLink Home [ HA.class' "sp-icon-btn", attr "aria-label" "戻る", HA.title "戻る" ] [ icon "back" ]
      , HE.h1 [ HA.id contentHeadingId, HA.tabindex (-1) ] [ HE.text "投稿" ]
      ]
  , case model.detail of
      Loaded { view: Just base, replies } ->
        let
          view = shownView model base
        in
          HE.div [ testId "post-detail", attr "data-state" "loaded" ]
            [ directPost model base
            , case view.post of
                Just post -> HE.div_
                  [ HE.div
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
                          RepliesTab -> repliesPanel model replies
                          ReactionsTab -> Reaction.detailPanel model post
                      ]
                  ]
                Nothing -> emptySlot
            ]
      Loaded { view: Nothing } -> stateNote "post-detail" "missing" "投稿が見つかりません"
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

-- | The page-local reveal of a post, if any (S8: never stored; leaving drops it).
shownView :: Model -> PostView -> PostView
shownView model base = fromMaybe base (find (\view -> view.id == base.id) model.content.reveals)

revealed :: Model -> String -> Boolean
revealed model id = any (\view -> view.id == id) model.content.reveals

revealErrorOf :: Model -> String -> Maybe ApiError
revealErrorOf model id = case model.content.revealError of
  Just failure | failure.id == id -> Just failure.error
  _ -> Nothing

-- | The opened post itself: hidden card (3-1), revealed with its bar (3-2), or as is.
directPost :: Model -> PostView -> Html Message
directPost model base = case base.hidden of
  Just control
    | revealed model base.id -> HE.section [ HA.class' "sp-revealed", attr "aria-label" "投稿", testId "revealed-post" ]
        [ revealedBar { key: base.id, control, hide: HidePost base.id }
        , HE.div [ HA.class' "sp-tl-focused" ] [ viewBody model Focused (shownView model base) ]
        ]
    | otherwise -> hiddenCard model
        { key: base.id
        , title: controlLabel control.mode <> "中のドメインの投稿です"
        , label: "この投稿だけ表示"
        , control
        , reveal: RevealPost base.id
        , pending: elem base.id model.content.revealing
        , error: revealErrorOf model base.id
        }
  Nothing -> HE.div [ HA.class' "sp-tl sp-tl-focused" ] [ viewBody model Focused base ]

-- | ui-spec 3-5: visible replies as usual; replies of controlled domains fold into
-- | "非表示の返信 n 件" and, unfolded, are revealed one by one with [表示].
repliesPanel :: Model -> Array PostView -> Html Message
repliesPanel model replies
  | null replies = HE.p [ HA.class' "sp-dempty" ] [ HE.text "まだ返信はありません" ]
  | otherwise =
      HE.div [ HA.class' "sp-tl sp-tl-replies" ]
        ( map (viewBody model InTimeline) shown
            <>
              if null folded then []
              else
                [ HE.button
                    [ HA.type' "button"
                    , HA.id "sp-hidden-replies-toggle"
                    , HA.class' "sp-fold"
                    , attr "aria-expanded" (if model.content.repliesOpen then "true" else "false")
                    , attr "aria-controls" "sp-hidden-replies"
                    , testId "hidden-replies"
                    , HA.onClick ToggleHiddenReplies
                    ]
                    [ icon "chevdown", HE.text ("非表示の返信 " <> show (length folded) <> " 件") ]
                , HE.div [ HA.id "sp-hidden-replies", HA.hidden (not model.content.repliesOpen) ]
                    (map hiddenReply folded)
                ]
        )
      where
      shown = filter (\reply -> isNothing reply.hidden) replies
      folded = filter (\reply -> isJust reply.hidden) replies
      hiddenReply reply = case reply.hidden of
        Just control
          | revealed model reply.id -> HE.div [ HA.class' "sp-revealed sp-revealed-reply", testId "revealed-reply" ]
              [ revealedBar { key: reply.id, control, hide: HidePost reply.id }
              , viewBody model InTimeline (shownView model reply)
              ]
          | otherwise -> HE.div [ HA.class' "sp-hidden-row", testId "hidden-reply", attr "data-domain" control.domain ]
              [ HE.span [ HA.class' "sp-grow" ] [ HE.text (controlLabel control.mode <> "中のドメインの返信") ]
              , HE.button
                  [ HA.type' "button"
                  , HA.id (revealButtonId reply.id)
                  , HA.class' "sp-text-btn"
                  , HA.disabled (elem reply.id model.content.revealing)
                  , HA.onClick (RevealPost reply.id)
                  ]
                  [ HE.text "表示" ]
              , case revealErrorOf model reply.id of
                  Just error -> HE.span [ HA.class' "sp-state-error", attr "role" "alert", attr "data-error" (Error.tag error) ] [ HE.text "表示できませんでした" ]
                  Nothing -> emptySlot
              ]
        Nothing -> emptySlot

-- | A person's page (ui-spec 3-6): name, bio and the "ミュート中／ブロック中のドメイン" badge
-- | always; their posts hidden like 3-1 until [投稿を表示] (this page only). While the
-- | domain is blocked, follow and the posts' operations stay locked (3-3 / 4-1); the
-- | "…" menu offers the same items as a post's, including unblocking (4-2).
userPage :: Model -> String -> Html Message
userPage model handle = HE.div [ HA.class' "sp-page sp-page-user" ]
  [ HE.div [ HA.class' "sp-detail-head" ]
      [ routeLink Home [ HA.class' "sp-icon-btn", attr "aria-label" "戻る", HA.title "戻る" ] [ icon "back" ]
      , HE.h1 [ HA.id contentHeadingId, HA.tabindex (-1) ]
          [ HE.text case model.content.user of
              Loaded (Just page) -> page.author.displayName
              _ -> "ユーザー"
          ]
      ]
  , case model.content.user of
      Loaded (Just page) -> HE.div [ testId "user-page", attr "data-state" "loaded" ]
        [ HE.div [ HA.class' "sp-user-head" ]
            [ avatar AvatarLarge page.author
            , HE.div [ HA.class' "sp-grow" ]
                [ HE.div [ HA.class' "sp-user-name" ] [ HE.text page.author.displayName ]
                , HE.div [ HA.class' "sp-user-handle" ]
                    [ HE.span [ HA.class' "sp-mono" ] [ HE.text ("@" <> page.author.handle) ]
                    , case page.control of
                        Just control -> HE.span [ HA.class' ("sp-badge" <> if control.mode == BLOCK then " sp-badge-block" else ""), testId "domain-badge" ]
                          [ icon (if control.mode == BLOCK then "block" else "eyeoff"), HE.text (controlLabel control.mode <> "中のドメイン") ]
                        Nothing -> emptySlot
                    ]
                ]
            , HE.div [ HA.class' "sp-user-actions" ]
                [ postMenu model ("user-" <> handle) page.author
                , followButton page
                ]
            ]
        , HE.p [ HA.class' "sp-user-bio" ] [ HE.text page.bio ]
        , case model.content.userRevealed, page.hidden of
            Just shown, Just control -> HE.section [ HA.class' "sp-revealed", attr "aria-label" "投稿", testId "revealed-posts" ]
              [ revealedBar { key: "user", control, hide: HideUserPosts }
              , postsList shown.posts
              ]
            Nothing, Just control -> hiddenCard model
              { key: "user"
              , title: controlLabel control.mode <> "中のドメインの投稿です"
              , label: "投稿を表示"
              , control
              , reveal: RevealUserPosts
              , pending: model.content.userRevealing
              , error: model.content.userRevealError
              }
            _, Nothing -> postsList page.posts
        ]
      Loaded Nothing -> stateNote "user-page" "missing" "ユーザーが見つかりません"
      Failed error -> errorNote "user-page" "ユーザーを表示できません" error
      _ -> stateNote "user-page" "loading" "読み込み中…"
  ]
  where
  postsList posts
    | null posts = HE.p [ HA.class' "sp-dempty" ] [ HE.text "まだ投稿はありません" ]
    | otherwise = HE.div [ HA.class' "sp-tl" ] (map (viewBody model InTimeline) posts)
  -- Following has no screen yet; while the domain is blocked it is locked (4-1).
  followButton page = case page.control of
    Just control | control.mode == BLOCK -> HE.button
      [ HA.type' "button"
      , HA.id "sp-follow"
      , HA.class' "sp-follow sp-act-locked"
      , attr "aria-label" "フォロー（ブロック中）"
      , attr "aria-haspopup" "dialog"
      , HA.onClick (MuteBlockMsg (MuteBlock.OpenBlockedSheet "sp-follow" "フォロー" control.domain control.revision))
      ]
      [ icon "lock", HE.text "フォロー" ]
    _ -> HE.button
      [ HA.type' "button", HA.id "sp-follow", HA.class' "sp-follow", attr "aria-disabled" "true", HA.title "フォロー（未実装）" ]
      [ HE.text "フォロー" ]

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
