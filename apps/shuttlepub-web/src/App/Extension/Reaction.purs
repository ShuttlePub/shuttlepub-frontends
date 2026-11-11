-- | Quick reaction UI (D03, unit quick-reaction-web-ui) at the extension points the
-- | layout (F0) calls. ui-spec v6: host intents/shuttlepub/features/quick-reaction-ui.
-- |
-- | - summary            reaction chips under the body (C1 my chip first, C3, C4 top 8 + 「+N」)
-- | - actionButton       the reaction button; while reacted it is not rendered and the
-- |                      cell keeps its width (アクション行). Desktop popover picker (P5).
-- | - detailTabCount     total reactions on the 「リアクション」 tab (D1)
-- | - detailPanel        「すべて」 + one toggle per emoji, reactor list, me first (D1, D3)
-- | - settingsProfileRows 設定 > Profile 「常用絵文字」 (S1-S6)
-- | - overlay            mobile picker sheet, favourites picker dialog, chip menu sheet,
-- |                      click-away layer and the toast (P5, C2, P2, S2)
-- |
-- | Keyboard: no keydown handlers here (App.Dom.keydownAction is the only one). Esc and
-- | the picker's category tabs (data-tablist="picker") go through Client.Update.
module App.Extension.Reaction
  ( summary
  , actionButton
  , reactionButtonId
  , detailTabCount
  , detailPanel
  , settingsProfileRows
  , overlay
  , mineChipId
  , pickerId
  , pickerSearchId
  , pickerTabId
  , favoriteChipId
  , favoriteAddId
  , chipMenuId
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.Error as Error
import App.Dom (preventDefault)
import App.Emoji (Emoji, EmojiKind(..), categories, categoryEmojis, customCategoryId, emojiKey, emojiLabel, sameEmoji, searchEmojis)
import App.Message (Message(..))
import App.Model (Model, RemoteData(..), activeProfile)
import App.Post (Post)
import App.Profile (Profile)
import App.Reaction (Chip, DetailFilter(..), PickerState, PickerTarget(..), PostReactions, PostRef, ReactionMsg(..), Reactor, ToastKind(..), chipsOf, maxChips, maxFavorites, postReactionsFor, reactorRows, tooltipOf, totalCount)
import App.ReactionDom (blurTarget, leavesClosest, startDrag)
import App.Route (Route(..))
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, errorNote, icon, routeLink, stateNote, testId, visuallyHidden)
import Data.Array (any, drop, elem, length, mapWithIndex, null, take)
import Data.Maybe (Maybe(..), isJust)
import Data.String (trim)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Flame.Types (NodeData)

-- Ids (focus targets) -------------------------------------------------------------

reactionButtonId :: Post -> String
reactionButtonId post = "react-" <> post.id

mineChipId :: String -> String
mineChipId postId = "react-mine-" <> postId

pickerId :: String
pickerId = "sp-picker"

pickerSearchId :: String
pickerSearchId = "sp-picker-search"

pickerTabId :: String -> String
pickerTabId category = "sp-picker-tab-" <> category

favoriteChipId :: Int -> String
favoriteChipId index = "sp-fav-chip-" <> show index

favoriteAddId :: String
favoriteAddId = "sp-fav-add"

chipMenuId :: String
chipMenuId = "sp-fav-menu"

-- Helpers -------------------------------------------------------------------------

reaction :: ReactionMsg -> Message
reaction = Reaction

refOf :: Post -> PostRef
refOf post = { postId: post.id, noteId: post.noteId }

me :: Model -> Maybe Reactor
me model = activeProfile model <#> \profile -> { id: profile.id, handle: profile.handle, displayName: profile.displayName }

reactionsOf :: Model -> Post -> Maybe PostReactions
reactionsOf model post = postReactionsFor model.reaction.posts post.noteId

inFlight :: Model -> Post -> Boolean
inFlight model post = elem post.noteId model.reaction.inFlight

-- | The emoji itself: a character, the custom emoji image, or a placeholder once the
-- | image is gone (deleted). Decorative: the control around it carries the name.
glyph :: Emoji -> Html Message
glyph emoji = case emoji.kind, emoji.imageUrl of
  UnicodeEmoji, _ -> HE.span [ HA.class' "sp-emo", attr "aria-hidden" "true" ] [ HE.text emoji.value ]
  CustomEmoji, Just url -> HE.img [ HA.class' "sp-emo sp-emo-img", HA.src url, HA.alt "", attr "aria-hidden" "true", attr "draggable" "false" ]
  CustomEmoji, Nothing -> HE.span [ HA.class' "sp-emo sp-emo-missing", attr "aria-hidden" "true" ] [ HE.text "?" ]

-- | Icons this unit needs beyond App.View.Common.icon (same 24px outline style).
rIcon :: String -> Html Message
rIcon kind = HE.svg
  [ HA.viewBox "0 0 24 24"
  , HA.fill "none"
  , HA.stroke "currentColor"
  , HA.strokeWidth "1.6"
  , attr "aria-hidden" "true"
  , HA.class' ("sp-icon sp-icon-" <> kind)
  ]
  [ HE.path [ HA.d path, HA.strokeLinecap "round", HA.strokeLinejoin "round" ] [] ]
  where
  path = case kind of
    "plus" -> "M12 5v14M5 12h14"
    "swap" -> "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"
    "left" -> "M15 5l-7 7 7 7"
    "right" -> "M9 5l7 7-7 7"
    "trash" -> "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
    _ -> "M12 12h.01"

problemText :: ApiError -> String
problemText = case _ of
  RevisionConflict _ -> "別の端末で変更されたため、保存されている内容を表示しています"
  EmojiUnavailable _ -> "利用できない絵文字は追加できません"
  error -> "保存できませんでした（" <> Error.describe error <> "）"

-- Post card -----------------------------------------------------------------------

-- | C1 / C3 / C4 chips. My chip (always first) removes my reaction; someone's chip
-- | reacts with the same emoji only while I have not reacted and it is usable.
summary :: Model -> Post -> Html Message
summary model post = case reactionsOf model post of
  Nothing -> emptySlot
  Just reactions ->
    let
      chips = chipsOf (me model) reactions
      reacted = isJust reactions.mine
      hidden = length chips - maxChips
    in
      if null chips then emptySlot
      else HE.div [ HA.class' "sp-reactions", testId "reactions", attr "data-post-id" post.id ]
        ( map (chip reacted) (take maxChips chips)
            <>
              if hidden > 0 then
                [ routeLink (PostDetail post.id) [ HA.class' "sp-rchip sp-rchip-more", attr "aria-label" ("ほか " <> show hidden <> " 種類") ]
                    [ HE.text ("+" <> show hidden) ]
                ]
              else []
        )
  where
  chip :: Boolean -> Chip -> Html Message
  chip reacted entry =
    let
      tip = tooltipOf entry
      label = emojiLabel entry.emoji
      classes = "sp-rchip" <> (if entry.mine then " is-mine" else "") <> (if entry.emoji.available then "" else " is-unavailable")
      inner = [ glyph entry.emoji, HE.span [ HA.class' "sp-rchip-count" ] [ HE.text (show entry.count) ] ]
    in
      if entry.mine then
        HE.button
          ( [ HA.type' "button"
            , HA.id (mineChipId post.id)
            , HA.class' classes
            , attr "aria-pressed" "true"
            , attr "aria-label" (label <> " を取り消す（" <> show entry.count <> "：" <> tip <> "）")
            , HA.title tip
            ] <> busyOr (reaction (RemoveMine (refOf post)))
          )
          inner
      else if not reacted && entry.emoji.available && isJust (activeProfile model) then
        HE.button
          ( [ HA.type' "button"
            , HA.class' classes
            , attr "aria-label" (label <> " でリアクション（" <> show entry.count <> "：" <> tip <> "）")
            , HA.title tip
            ] <> busyOr (reaction (ReactWithChip (refOf post) entry.emoji))
          )
          inner
      else
        HE.span [ HA.class' classes, HA.title tip ]
          (inner <> [ visuallyHidden (label <> " " <> show entry.count <> "：" <> tip) ])
  -- While a request for this post is in flight nothing else may be sent (二重送信防止).
  busyOr message =
    if inFlight model post then [ attr "aria-disabled" "true", attr "aria-busy" "true" ] else [ HA.onClick message ]

-- | The reaction button (opens the picker). Not rendered while reacted: my chip takes
-- | its role, the cell keeps its width so nothing moves (C1, アクション行).
actionButton :: Model -> Post -> Html Message
actionButton model post = case reactionsOf model post of
  Just { mine: Just _ } -> emptySlot
  known -> HE.div [ HA.class' "sp-react-anchor" ]
    [ HE.button
        ( [ HA.type' "button"
          , HA.id (reactionButtonId post)
          , HA.class' "sp-act sp-react-btn"
          , attr "aria-label" "リアクション"
          , attr "aria-haspopup" "dialog"
          , attr "aria-expanded" (if open then "true" else "false")
          , HA.title "リアクション"
          ] <>
            if ready then [ HA.onClick (reaction (OpenPicker (ReactTo (refOf post)) (reactionButtonId post))) ]
            else [ attr "aria-disabled" "true" ]
        )
        [ icon "react" ]
    , if open && not model.isMobile then popover model else emptySlot
    ]
    where
    open = case model.reaction.picker of
      Just { target: ReactTo ref } -> ref.postId == post.id
      _ -> false
    -- The state of this post is known (or could not be read: trying shows the error).
    ready = isJust (activeProfile model) && not (inFlight model post)
      && (isJust known || isJust model.reaction.postsError)

-- Picker --------------------------------------------------------------------------

popover :: Model -> Html Message
popover model = case model.reaction.picker of
  Just picker -> HE.div
    [ HA.id pickerId
    , HA.class' "sp-picker sp-picker-pop"
    , attr "role" "dialog"
    , attr "aria-label" "絵文字"
    , HA.tabindex (-1)
    , testId "picker"
    , HA.onClick NoOp
    ]
    (pickerBody model picker)
  Nothing -> emptySlot

pickerTitle :: PickerTarget -> String
pickerTitle = case _ of
  ReactTo _ -> "絵文字"
  AddFavorite -> "常用絵文字を追加"
  ReplaceFavorite _ -> "常用絵文字を入れ替え"

-- | Search, then (reacting, not searching) the favourites row without a heading and a
-- | gear at its end (P1, P4, P6), then category tabs and the grid. No favourites
-- | saved: no row and no link (P3).
pickerBody :: Model -> PickerState -> Array (Html Message)
pickerBody model picker =
  [ HE.label [ HA.class' "sp-pk-search" ]
      [ icon "search"
      , HE.input
          [ HA.id pickerSearchId
          , HA.type' "search"
          , HA.placeholder "検索"
          , attr "aria-label" "絵文字を検索"
          , attr "autocomplete" "off"
          , HA.onInput (reaction <<< PickerSearch)
          ]
      ]
  , if reacting && not searching then favoritesRow else emptySlot
  , if searching then emptySlot else tabs
  , results
  ]
  where
  reacting = case picker.target of
    ReactTo _ -> true
    _ -> false
  searching = trim picker.query /= ""
  custom = case model.reaction.customEmojis of
    Loaded list -> list
    _ -> []
  taken emoji = not reacting && case model.reaction.settings of
    Loaded settings -> any (sameEmoji emoji) settings.favorites
    _ -> false
  favoritesRow = case model.reaction.settings of
    Loaded settings
      | null settings.favorites -> emptySlot
      | otherwise -> HE.div [ HA.class' "sp-pk-favs", attr "role" "group", attr "aria-label" "常用絵文字", testId "picker-favorites" ]
          ( map favorite settings.favorites
              <> [ routeLink Settings [ HA.class' "sp-pk-cfg", attr "aria-label" "常用絵文字を設定", HA.title "設定" ] [ icon "settings" ] ]
          )
    Failed error -> HE.p [ HA.class' "sp-pk-note sp-pk-error", attr "data-error" (Error.tag error), testId "picker-favorites-error" ]
      [ HE.text ("常用絵文字を読み込めません（" <> Error.describe error <> "）") ]
    _ -> emptySlot
  favorite emoji
    | emoji.available = HE.button
        [ HA.type' "button", HA.class' "sp-pk-fav", attr "aria-label" (emojiLabel emoji), HA.title (emojiLabel emoji), HA.onClick (reaction (Pick emoji)) ]
        [ glyph emoji ]
    -- P2 / D03 q05: greyed out, not selectable, nothing sent in its place.
    | otherwise = HE.button
        [ HA.type' "button"
        , HA.class' "sp-pk-fav is-unavailable"
        , attr "aria-disabled" "true"
        , attr "aria-label" (emojiLabel emoji <> "（利用不可）")
        , HA.title "利用不可"
        , HA.onClick (reaction (PickUnavailableFavorite emoji))
        ]
        [ glyph emoji ]
  tabs = HE.div [ HA.class' "sp-pk-tabs", attr "role" "tablist", attr "aria-label" "カテゴリ", attr "data-tablist" "picker" ]
    ( categories <#> \category ->
        let
          selected = category.id == picker.category
        in
          HE.button
            [ HA.type' "button"
            , HA.id (pickerTabId category.id)
            , HA.class' "sp-pk-tab"
            , attr "role" "tab"
            , attr "aria-selected" (if selected then "true" else "false")
            , attr "aria-label" category.label
            , attr "data-tab-value" category.id
            , HA.title category.label
            , HA.tabindex (if selected then 0 else (-1))
            , HA.onClick (reaction (PickerCategory category.id))
            ]
            [ HE.span [ HA.class' "sp-emo", attr "aria-hidden" "true" ] [ HE.text category.icon ] ]
    )
  results
    | searching = grid (searchEmojis custom picker.query) "見つかりません"
    | picker.category == customCategoryId = case model.reaction.customEmojis of
        Failed error -> HE.p [ HA.class' "sp-pk-note sp-pk-error", attr "data-error" (Error.tag error) ]
          [ HE.text ("カスタム絵文字を読み込めません（" <> Error.describe error <> "）") ]
        Loaded _ -> grid (categoryEmojis custom customCategoryId) "カスタム絵文字はありません"
        _ -> HE.p [ HA.class' "sp-pk-note" ] [ HE.text "読み込み中…" ]
    | otherwise = grid (categoryEmojis custom picker.category) "見つかりません"
  grid emojis empty
    | null emojis = HE.p [ HA.class' "sp-pk-note" ] [ HE.text empty ]
    | otherwise = HE.div [ HA.class' "sp-pk-grid", testId "picker-grid" ]
        ( emojis <#> \emoji -> HE.button
            [ HA.type' "button"
            , HA.class' "sp-pk-emo"
            , attr "aria-label" (emojiLabel emoji)
            , HA.title (emojiLabel emoji)
            , HA.disabled (taken emoji)
            , HA.onClick (reaction (Pick emoji))
            ]
            [ glyph emoji ]
        )

-- Post detail ---------------------------------------------------------------------

detailTabCount :: Model -> Post -> Maybe Int
detailTabCount model post = totalCount <$> reactionsOf model post

-- | D1: 「すべて」 is selected when the tab opens; an emoji shows only its reactors;
-- | pressing the selected toggle again closes the list. D3: me first with 「あなた」.
detailPanel :: Model -> Post -> Html Message
detailPanel model post = case reactionsOf model post of
  Nothing -> case model.reaction.postsError of
    Just error -> errorNote "reactors" "リアクションを表示できません" error
    Nothing -> stateNote "reactors" "loading" "読み込み中…"
  Just reactions
    | totalCount reactions == 0 -> HE.p [ HA.class' "sp-dempty", testId "reactors", attr "data-state" "empty" ] [ HE.text "まだリアクションはありません" ]
    | otherwise ->
        let
          filterBy = model.reaction.detailFilter
          rows = reactorRows (me model) filterBy reactions
        in
          HE.div [ HA.class' "sp-reactors", testId "reactors", attr "data-state" "loaded" ]
            [ HE.div [ HA.class' "sp-rtabs", attr "role" "group", attr "aria-label" "絵文字ごとに反応した人を表示" ]
                ( [ toggle AllReactors [ HE.text ("すべて " <> show (totalCount reactions)) ] Nothing ]
                    <> map (\entry -> toggle (OnlyEmoji (emojiKey entry.emoji)) [ glyph entry.emoji, HE.text (" " <> show entry.count) ] (Just (emojiLabel entry.emoji <> " " <> show entry.count)))
                      (chipsOf (me model) reactions)
                )
            , if filterBy == ListClosed then HE.p [ HA.class' "sp-rhint" ] [ HE.text "絵文字を選ぶと反応した人を表示します（もう一度押すと閉じる）" ]
              else HE.ul [ HA.class' "sp-reactor-list", attr "aria-label" "反応した人", testId "reactor-list" ]
                ( rows <#> \row -> HE.li [ HA.class' "sp-reactor" ]
                    [ avatar AvatarSmall row.reactor
                    , HE.span [ HA.class' "sp-grow" ]
                        [ HE.span [ HA.class' "sp-reactor-name" ] [ HE.text row.reactor.displayName ]
                        , if row.you then HE.span [ HA.class' "sp-you-badge" ] [ HE.text "あなた" ] else emptySlot
                        , HE.span [ HA.class' "sp-muted sp-reactor-handle" ] [ HE.text ("@" <> row.reactor.handle) ]
                        ]
                    , glyph row.emoji
                    ]
                )
            ]
  where
  toggle value content label = HE.button
    ( [ HA.type' "button"
      , HA.class' "sp-rtab"
      , attr "aria-pressed" (if model.reaction.detailFilter == value then "true" else "false")
      , HA.onClick (reaction (SelectDetailFilter value))
      ] <> case label of
        Just text -> [ attr "aria-label" text ]
        Nothing -> []
    )
    content

-- Settings > Profile ----------------------------------------------------------------

-- | S1-S6: favourites as chips with 「＋」 at the end; each chip has a menu (入れ替え
-- | first, 左へ／右へ, 削除) and can be dragged. Saved on every operation, no success
-- | message (S2). Unavailable: grey chip + 「利用不可」 (S4). The section heading is the
-- | Profile (S5, App.View.Pages.settings).
settingsProfileRows :: Model -> Profile -> Array (Html Message)
settingsProfileRows model _ =
  [ HE.div [ HA.class' "sp-set-row sp-set-col" ]
      [ HE.span [ HA.class' "sp-set-label", HA.id "sp-fav-label" ] [ HE.text "常用絵文字" ]
      , case model.reaction.settings of
          Loaded settings -> favoriteChips model settings.favorites
          Failed error -> errorNote "favorites" "常用絵文字を読み込めません" error
          _ -> stateNote "favorites" "loading" "読み込み中…"
      , case model.reaction.settingsProblem of
          Just problem -> HE.p [ HA.class' "sp-fav-problem", attr "role" "alert", attr "data-error" (Error.tag problem.error), testId "favorites-problem" ]
            ( [ HE.text (problemText problem.error) ]
                <> case problem.retry of
                  Just _ -> [ HE.button [ HA.type' "button", HA.class' "sp-text-btn", HA.onClick (reaction RetrySettings), HA.disabled model.reaction.savingSettings ] [ HE.text "もう一度保存" ] ]
                  Nothing -> []
            )
          Nothing -> emptySlot
      ]
  ]

favoriteChips :: Model -> Array Emoji -> Html Message
favoriteChips model favorites = HE.ul
  [ HA.class' "sp-fchips"
  , attr "aria-labelledby" "sp-fav-label"
  , attr "aria-busy" (if saving then "true" else "false")
  , testId "favorites"
  , attr "data-state" "loaded"
  ]
  ( (if null favorites then [ HE.li [ HA.class' "sp-fchip-empty" ] [ HE.text "ありません" ] ] else [])
      <> mapWithIndex chip favorites
      <>
        if length favorites < maxFavorites then
          [ HE.li [ HA.class' "sp-fchip-wrap" ]
              [ HE.button
                  ( [ HA.type' "button", HA.id favoriteAddId, HA.class' "sp-fchip sp-fchip-add", attr "aria-label" "常用絵文字を追加", HA.title "追加" ]
                      <> enabled (OpenPicker AddFavorite favoriteAddId)
                  )
                  [ rIcon "plus" ]
              ]
          ]
        else []
  )
  where
  saving = model.reaction.savingSettings
  enabled message = if saving then [ attr "aria-disabled" "true" ] else [ HA.onClick (reaction message) ]
  chip index emoji =
    let
      open = model.reaction.chipMenu == Just index
      label = emojiLabel emoji <> if emoji.available then "" else "（利用不可）"
    in
      HE.li
        ( [ HA.class' ("sp-fchip-wrap" <> if model.reaction.dragFrom == Just index then " is-dragging" else "")
          , attr "draggable" (if saving then "false" else "true")
          , HA.createRawEvent "dragstart" \event -> startDrag event $> Just (reaction (DragStart index))
          , HA.createRawEvent "dragover" \event -> preventDefault event $> Nothing
          , HA.createRawEvent "drop" \event -> preventDefault event $> Just (reaction (DragDrop index))
          , HA.createRawEvent "dragend" \_ -> pure (Just (reaction DragEnd))
          ]
        )
        [ HE.button
            ( [ HA.type' "button"
              , HA.id (favoriteChipId index)
              , HA.class' ("sp-fchip" <> if emoji.available then "" else " is-unavailable")
              , attr "aria-haspopup" "menu"
              , attr "aria-expanded" (if open then "true" else "false")
              , attr "aria-label" label
              , HA.title label
              ] <> enabled (ToggleChipMenu index)
            )
            [ glyph emoji ]
        , if emoji.available then emptySlot else HE.span [ HA.class' "sp-fchip-badge" ] [ HE.text "利用不可" ]
        , if open && not model.isMobile then HE.div [ HA.class' "sp-chip-pop", HA.onClick NoOp ] [ chipMenu index emoji (length favorites) ] else emptySlot
        ]

chipMenu :: Int -> Emoji -> Int -> Html Message
chipMenu index emoji count = HE.div
  [ HA.id chipMenuId, HA.class' "sp-menu sp-chip-menu", attr "role" "menu", attr "aria-label" (emojiLabel emoji <> " の操作"), testId "favorite-menu" ]
  ( [ item "swap" "入れ替え" (StartReplaceFavorite index) false ]
      <> (if index > 0 then [ item "left" "左へ" (MoveFavorite index (index - 1)) false ] else [])
      <> (if index < count - 1 then [ item "right" "右へ" (MoveFavorite index (index + 1)) false ] else [])
      <> [ item "trash" "削除" (RemoveFavorite index) true ]
  )
  where
  item kind label message danger = HE.button
    [ HA.type' "button", HA.class' ("sp-menu-item" <> if danger then " sp-danger" else ""), attr "role" "menuitem", HA.onClick (reaction message) ]
    [ rIcon kind, HE.span [ HA.class' "sp-grow" ] [ HE.text label ] ]

-- Overlay ---------------------------------------------------------------------------

overlay :: Model -> Html Message
overlay model = HE.div [ HA.class' "sp-reaction-layer" ]
  [ pickerLayer
  , chipMenuLayer
  , toastView model
  ]
  where
  pickerLayer = case model.reaction.picker of
    Nothing -> emptySlot
    Just picker -> case picker.target of
      -- Desktop: the popover sits under the button (actionButton); this layer only
      -- catches clicks outside it.
      ReactTo _
        | not model.isMobile -> HE.div [ HA.class' "sp-clickaway", HA.onClick (reaction ClosePicker) ] []
      _
        | model.isMobile -> HE.div [ HA.class' "sp-sheet-backdrop", HA.onClick (reaction ClosePicker) ]
            [ HE.div (dialogAttrs picker "sp-sheet sp-picker sp-picker-sheet") ([ HE.div [ HA.class' "sp-sheet-grip", attr "aria-hidden" "true" ] [] ] <> pickerBody model picker) ]
        | otherwise -> HE.div [ HA.class' "sp-modal-backdrop", HA.onClick (reaction ClosePicker) ]
            [ HE.div (dialogAttrs picker "sp-picker sp-picker-modal") (pickerBody model picker) ]

  dialogAttrs :: PickerState -> String -> Array (NodeData Message)
  dialogAttrs picker classes =
    [ HA.id pickerId
    , HA.class' classes
    , attr "role" "dialog"
    , attr "aria-modal" "true"
    , attr "aria-label" (pickerTitle picker.target)
    , HA.tabindex (-1)
    , testId "picker"
    , HA.onClick NoOp
    ]
  chipMenuLayer = case model.reaction.chipMenu, model.reaction.settings of
    Just index, Loaded settings
      | Just emoji <- settings.favorites `at` index ->
          if model.isMobile then
            HE.div [ HA.class' "sp-sheet-backdrop", HA.onClick (reaction CloseChipMenu) ]
              [ HE.div [ HA.class' "sp-sheet", attr "role" "dialog", attr "aria-modal" "true", attr "aria-label" (emojiLabel emoji <> " の操作"), HA.onClick NoOp ]
                  [ HE.div [ HA.class' "sp-sheet-grip", attr "aria-hidden" "true" ] [], chipMenu index emoji (length settings.favorites) ]
              ]
          else HE.div [ HA.class' "sp-clickaway", HA.onClick (reaction CloseChipMenu) ] []
    _, _ -> emptySlot
  at list index = take 1 (drop index list) # \found -> case found of
    [ x ] -> Just x
    _ -> Nothing

-- | C2 / S2 / P2 toast. It stays while hovered, touched or focused (注意 3), and sits
-- | above the click-away layer so 「元に戻す」 works while a picker is open (注意 1).
toastView :: Model -> Html Message
toastView model = case model.reaction.toast of
  Nothing -> emptySlot
  Just toast -> HE.div
    ( [ HA.class' "sp-toast"
      , attr "role" "status"
      , testId "reaction-toast"
      , HA.createRawEvent "mouseover" \_ -> pure (Just (reaction (ToastHold true)))
      , HA.createRawEvent "mouseout" \event -> leavesClosest ".sp-toast" event <#> \left -> if left then Just (reaction (ToastHold false)) else Nothing
      , HA.createRawEvent "focusin" \_ -> pure (Just (reaction (ToastHold true)))
      , HA.createRawEvent "focusout" \event -> leavesClosest ".sp-toast" event <#> \left -> if left then Just (reaction (ToastHold false)) else Nothing
      , HA.createRawEvent "touchstart" \_ -> pure (Just (reaction (ToastHold true)))
      , HA.createRawEvent "touchend" \_ -> pure (Just (reaction (ToastHold false)))
      ] <> case toast.kind of
        ReactionFailed _ error -> [ attr "data-error" (Error.tag error) ]
        _ -> []
    )
    case toast.kind of
      UndoRemoval removal -> [ glyph removal.emoji, HE.span_ [ HE.text "取り消しました" ], button "元に戻す" ToastUndo ]
      UndoFavoriteRemoval _ emoji -> [ glyph emoji, HE.span_ [ HE.text "削除しました" ], button "元に戻す" ToastUndo ]
      FavoriteUnavailable emoji -> [ glyph emoji, HE.span_ [ HE.text "利用できません" ], button "入れ替える" ToastAction ]
      ReactionFailed text error -> [ HE.span_ [ HE.text (text <> "（" <> Error.describe error <> "）") ] ]
  where
  button label message = HE.button
    [ HA.type' "button", HA.class' "sp-toast-btn", HA.createRawEvent "click" \event -> blurTarget event $> Just (reaction message) ]
    [ HE.text label ]
