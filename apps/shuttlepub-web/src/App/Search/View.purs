-- | The post search screen (D04). Structure and wording follow the agreed UI mock (host
-- | intents/shuttlepub/features/note-search-ui/ui-spec.md v2 and mocks/index.html): a sticky search
-- | box whose author is a chip inside the field, a one-line problem, dense result cards with the
-- | match marked, and a tail that is either the auto-loading sentinel, "ここまで", or the
-- | interrupted / failed notice with its button. Explanations are left out on purpose (the help
-- | owns them).
-- |
-- | Highlighting builds text nodes and <mark> elements from pieces of text (App.Search.Dom); no
-- | note text is ever inserted as HTML. The card shows only what the contract carries: no avatar
-- | image (the letter icon, d09-q06), no counts, reactions or display name of its own.
module App.Search.View (view, sentinelAttr) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Dom (relativeTime)
import App.Message (Message(..))
import App.Model (Model)
import App.Search.Dom (highlightSegments, inputValue)
import App.Search.Text (authorHandle, authorInitial, authorName, knownAuthor)
import App.Search.Types as Search
import App.View.Common (AvatarSize(..), attr, avatar, emptySlot, icon, testId, visuallyHidden)
import Data.Array (length, mapWithIndex, null)
import Data.Maybe (Maybe(..), fromMaybe, isJust)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Effect (Effect)
import Web.Event.Event (Event, preventDefault)

-- | The attribute the scroll observer (Dom.js) looks for.
sentinelAttr :: String
sentinelAttr = "data-search-sentinel"

listboxId :: String
listboxId = "sp-search-listbox"

optionId :: Int -> String
optionId index = "sp-search-option-" <> show index

view :: Model -> Html Message
view model = map SearchMsg (screen model)

screen :: Model -> Html Search.Message
screen model = HE.div [ HA.class' "sp-page sp-page-search", testId "search" ]
  [ HE.h1 [ HA.class' "sp-visually-hidden" ] [ HE.text "検索" ]
  , searchBox model
  , resultsView model
  ]

authorAvatar :: AvatarSize -> Search.Author -> Html Search.Message
authorAvatar size author = avatar size { id: author.actorUrl, displayName: authorInitial author }

-- ---------------------------------------------------------------- 検索欄

searchBox :: Model -> Html Search.Message
searchBox model = HE.div [ HA.class' "sp-search-box", attr "role" "search", attr "aria-label" "投稿検索" ]
  [ HE.div [ HA.class' ("sp-search-field" <> if isJust search.problem then " is-invalid" else ""), testId "search-field" ]
      [ icon "search"
      , case search.author of
          Just author -> chip author
          Nothing -> emptySlot
      , HE.input
          ( [ HA.type' "text"
            , HA.id Search.searchInputId
            , HA.class' "sp-search-input"
            , HA.value search.input
            , HA.placeholder (if isJust search.author then "キーワード" else "キーワード、from:@ユーザー")
            , HA.onInput Search.InputChanged
            , HA.createRawEvent "compositionstart" (\_ -> pure (Just Search.CompositionStarted))
            , HA.createRawEvent "compositionend" compositionEnded
            , attr "role" "combobox"
            , attr "aria-label" "投稿を検索"
            , attr "aria-autocomplete" "list"
            , attr "aria-haspopup" "listbox"
            , attr "aria-controls" listboxId
            , attr "aria-expanded" (if listShown then "true" else "false")
            , attr "autocomplete" "off"
            , attr "autocapitalize" "off"
            , attr "autocorrect" "off"
            , attr "spellcheck" "false"
            , attr "enterkeyhint" "search"
            , testId "search-input"
            ]
              <> case search.suggest.active of
                Just index | listShown -> [ attr "aria-activedescendant" (optionId index) ]
                _ -> []
              <> case search.problem of
                Just _ -> [ attr "aria-invalid" "true", attr "aria-describedby" problemId ]
                Nothing -> []
          )
      , if search.input /= "" || isJust search.author then
          HE.button
            [ HA.type' "button"
            , HA.class' "sp-search-clear"
            , attr "aria-label" "検索条件をクリア"
            , HA.title "クリア"
            , HA.onClick Search.ClearAll
            , testId "search-clear"
            ]
            [ icon "close" ]
        else emptySlot
      , suggestionList search
      ]
  , case search.problem of
      Just problem -> HE.p [ HA.id problemId, HA.class' "sp-search-problem", attr "role" "alert", testId "search-problem" ] [ HE.text (problemText problem) ]
      Nothing -> emptySlot
  , if isJust search.resolving then visuallyHidden "投稿者を確認しています" else emptySlot
  ]
  where
  search = model.search
  listShown = search.suggest.open && length search.suggest.items > 0

problemId :: String
problemId = "sp-search-problem"

compositionEnded :: Event -> Effect (Maybe Search.Message)
compositionEnded event = do
  value <- inputValue event
  pure (Just (Search.CompositionEnded value))

-- | The author chip of the field: the name, the person's `@acct` apart when it is known.
chip :: Search.Author -> Html Search.Message
chip author = HE.span
  [ HA.class' "sp-search-chip"
  , testId "author-chip"
  , attr "data-actor-url" author.actorUrl
  , HA.title (authorName author <> if author.acct == "" then "" else " " <> authorHandle author)
  , attr "role" "group"
  , attr "aria-label" ("投稿者 " <> authorName author <> if author.acct == "" then "" else " " <> authorHandle author)
  ]
  [ authorAvatar AvatarTiny author
  , HE.span [ HA.class' "sp-search-chip-text" ]
      [ HE.span [ HA.class' "sp-search-chip-from" ] [ HE.text "from:" ]
      , HE.text (if author.acct == "" then authorName author else authorHandle author)
      ]
  , HE.button
      [ HA.type' "button"
      , HA.class' "sp-search-chip-remove"
      , attr "aria-label" (authorName author <> " を外す")
      , HA.onClick Search.RemoveAuthor
      , testId "author-chip-remove"
      ]
      [ icon "close" ]
  ]

suggestionList :: Search.Model -> Html Search.Message
suggestionList search
  | not search.suggest.open = emptySlot
  | length search.suggest.items > 0 =
      HE.ul
        [ HA.id listboxId
        , HA.class' "sp-search-suggest"
        , attr "role" "listbox"
        , attr "aria-label" "投稿者の候補"
        , testId "author-suggestions"
        ]
        (mapWithIndex (suggestionOption search) search.suggest.items)
  | otherwise = HE.div [ HA.class' "sp-search-suggest sp-search-suggest-note", attr "role" "status", testId "author-suggestions-note" ]
      [ HE.text
          ( if search.suggest.loading then "候補を探しています…"
            else if search.suggest.failed then "候補を取得できません"
            else "該当する投稿者はいません"
          )
      ]

suggestionOption :: Search.Model -> Int -> Search.Author -> Html Search.Message
suggestionOption search index author = HE.li
  [ HA.id (optionId index)
  , HA.class' ("sp-search-option" <> if search.suggest.active == Just index then " is-active" else "")
  , attr "role" "option"
  , attr "aria-selected" (if search.suggest.active == Just index then "true" else "false")
  , attr "data-actor-url" author.actorUrl
  -- A mouse press must not move focus out of the field before the click picks the option.
  , HA.createRawEvent "mousedown" (\event -> preventDefault event $> Nothing)
  , HA.onClick (Search.PickSuggestion index)
  , testId "author-suggestion"
  ]
  [ authorAvatar AvatarSmall author
  , HE.span [ HA.class' "sp-search-option-name" ] [ HE.text (authorName author) ]
  , if author.acct /= "" && author.displayName /= Nothing then HE.span [ HA.class' "sp-search-option-acct" ] [ HE.text ("@" <> author.acct) ] else emptySlot
  ]

problemText :: Search.Problem -> String
problemText = case _ of
  Search.NotFound acct -> "@" <> acct <> " は見つかりません"
  Search.Ambiguous acct -> "@" <> acct <> " は複数見つかりました。ホストも入力してください"
  Search.EmptyAcct -> "from:@ のあとにユーザー名を入力してください"
  Search.LookupFailed error -> lookupText error

-- | One short line per failure of the author lookup (never a fallback to a made-up author).
lookupText :: ApiError -> String
lookupText = case _ of
  NotImplemented _ -> "投稿者の検索はまだ使えません"
  RateLimited _ -> "リクエストが多すぎます。しばらくしてからもう一度"
  AuthorLookupUnavailable _ -> "投稿者を確認できません。しばらくしてからもう一度"
  InvalidRequest _ -> "この投稿者名は使えません"
  _ -> "投稿者を確認できません"

-- ---------------------------------------------------------------- 結果

resultsView :: Model -> Html Search.Message
resultsView model = case model.search.results of
  Search.Idle -> HE.div [ HA.class' "sp-search-results", attr "data-state" (if model.search.waiting then "waiting" else "idle"), testId "search-results" ]
    [ if model.search.waiting then skeletons else emptySlot ]
  Search.Searching -> HE.div [ HA.class' "sp-search-results", attr "data-state" "searching", attr "aria-busy" "true", testId "search-results" ]
    [ skeletons, visuallyHidden "検索中" ]
  Search.SearchFailed error -> HE.div [ HA.class' "sp-search-results", attr "data-state" "error", testId "search-results" ]
    [ failure error ]
  Search.Found notes tail -> HE.div
    [ HA.class' "sp-search-results"
    , attr "data-state" "found"
    , attr "data-count" (show (length notes))
    , testId "search-results"
    ]
    ( [ if null notes then emptyNote tail else list model notes ]
        <> [ tailView tail ]
    )

skeletons :: Html Search.Message
skeletons = HE.div [ HA.class' "sp-search-skeletons", attr "aria-hidden" "true", testId "search-skeleton" ]
  (map (\_ -> skeleton) [ 1, 2, 3, 4 ])
  where
  skeleton = HE.div [ HA.class' "sp-search-note sp-search-note-skeleton" ]
    [ HE.span [ HA.class' "sp-avatar sp-avatar-sm sp-skeleton" ] []
    , HE.div [ HA.class' "sp-search-note-main" ]
        [ HE.span [ HA.class' "sp-search-line sp-skeleton" ] []
        , HE.span [ HA.class' "sp-search-line sp-search-line-short sp-skeleton" ] []
        ]
    ]

-- | Zero shown notes: nothing found, or nothing yet while the time limit cut the search.
emptyNote :: Search.Tail -> Html Search.Message
emptyNote = case _ of
  Search.End -> HE.p [ HA.class' "sp-state", attr "role" "status", testId "search-empty" ] [ HE.text "該当する投稿はありません" ]
  _ -> emptySlot

list :: Model -> Array Search.Note -> Html Search.Message
list model notes = HE.div [ HA.class' "sp-search-list", testId "search-list" ] (map (card model) notes)

card :: Model -> Search.Note -> Html Search.Message
card model note = HE.article
  [ HA.class' "sp-search-note"
  , attr "data-note-id" note.id
  , attr "data-kind" (kindValue note.kind)
  , testId "search-note"
  ]
  [ authorAvatar AvatarSmall author
  , HE.div [ HA.class' "sp-search-note-main" ]
      [ HE.div [ HA.class' "sp-search-note-head" ]
          [ HE.span [ HA.class' "sp-search-note-name", testId "search-note-author" ] [ HE.text (authorName author) ]
          , if author.acct /= "" && author.displayName /= Nothing then HE.span [ HA.class' "sp-search-note-handle" ] [ HE.text ("@" <> author.acct) ] else emptySlot
          , case note.kind of
              Search.PostKind -> emptySlot
              Search.ReplyKind -> HE.span [ HA.class' "sp-badge sp-search-kind" ] [ HE.text "返信" ]
              Search.QuoteKind -> HE.span [ HA.class' "sp-badge sp-search-kind" ] [ HE.text "引用" ]
          , HE.time [ HA.class' "sp-search-note-time", attr "datetime" note.createdAt ] [ HE.text (relativeTime model.now note.createdAt) ]
          ]
      , body
      ]
  ]
  where
  author = knownAuthor model.search.known note.authorActorUrl
  query = fromMaybe "" model.search.condition.q
  marked text = map piece (highlightSegments query text)
  piece segment
    | segment.hit = HE.mark [ HA.class' "sp-search-mark", testId "search-mark" ] [ HE.text segment.text ]
    | otherwise = HE.text segment.text
  textBody text = HE.p [ HA.class' "sp-search-note-text", testId "search-note-text" ] (marked text)
  -- A content-warned note is folded. The contract gives the warning only (the body is not part of the
  -- search result), so there is nothing to open; a body, were one given, would sit behind the warning.
  body = case note.contentWarning of
    Just warning | warning /= "", Nothing <- note.text ->
      HE.div [ HA.class' "sp-search-cw sp-search-cw-closed", testId "search-note-cw" ]
        [ HE.span [ HA.class' "sp-badge" ] [ HE.text "CW" ]
        , HE.span [ HA.class' "sp-search-cw-text" ] (marked warning)
        ]
    Just warning | warning /= "" -> HE.details [ HA.class' "sp-search-cw", testId "search-note-cw" ]
      [ HE.summary [ HA.class' "sp-search-cw-summary" ]
          [ HE.span [ HA.class' "sp-search-cw-text" ] (marked warning)
          , HE.span [ HA.class' "sp-search-cw-more" ] [ HE.text "表示" ]
          ]
      , case note.text of
          Just text -> textBody text
          Nothing -> emptySlot
      ]
    _ -> case note.text of
      Just text -> textBody text
      Nothing -> emptySlot

kindValue :: Search.NoteKind -> String
kindValue = case _ of
  Search.PostKind -> "post"
  Search.ReplyKind -> "reply"
  Search.QuoteKind -> "quote"

tailView :: Search.Tail -> Html Search.Message
tailView = case _ of
  Search.End -> HE.p [ HA.class' "sp-search-end", testId "search-end" ] [ HE.text "ここまで" ]
  -- Only this tail loads by itself: the sentinel is what the scroll observer waits for.
  Search.Next cursor -> HE.div [ HA.class' "sp-search-tail", attr sentinelAttr cursor, attr "data-state" "next", testId "search-sentinel" ]
    [ HE.span [ HA.class' "sp-muted" ] [ HE.text "読み込み中…" ] ]
  Search.LoadingNext _ -> HE.div [ HA.class' "sp-search-tail", attr "role" "status", attr "aria-busy" "true", attr "data-state" "loading", testId "search-loading" ]
    [ HE.span [ HA.class' "sp-muted" ] [ HE.text "読み込み中…" ] ]
  -- The time limit cut the search: what was found stays, nothing loads by itself (d04-q17).
  Search.Interrupted _ -> HE.div [ HA.class' "sp-search-tail sp-search-interrupted", attr "role" "status", attr "data-state" "interrupted", testId "search-interrupted" ]
    [ HE.span [] [ HE.text "ここまでで中断しました" ]
    , HE.button [ HA.type' "button", HA.class' "sp-btn sp-btn-secondary", HA.onClick Search.LoadMore, testId "search-continue" ]
        [ HE.text "途中から続きを読む" ]
    ]
  Search.NextFailed _ error -> HE.div [ HA.class' "sp-search-tail sp-search-failed", attr "role" "alert", attr "data-state" "failed", attr "data-error" (errorTag error), testId "search-more-failed" ]
    [ HE.span [] [ HE.text (searchErrorText error) ]
    , HE.button [ HA.type' "button", HA.class' "sp-btn sp-btn-secondary", HA.onClick Search.LoadMore, testId "search-retry-more" ]
        [ HE.text "もう一度" ]
    ]

failure :: ApiError -> Html Search.Message
failure error = HE.div [ HA.class' "sp-state sp-state-error sp-search-error", attr "role" "alert", attr "data-error" (errorTag error), testId "search-error" ]
  ( [ HE.span [] [ HE.text (searchErrorText error) ] ]
      <> case error of
        NotImplemented _ -> []
        _ -> [ HE.button [ HA.type' "button", HA.class' "sp-btn sp-btn-secondary", HA.onClick Search.Retry, testId "search-retry" ] [ HE.text "もう一度" ] ]
  )

errorTag :: ApiError -> String
errorTag = case _ of
  NotImplemented _ -> "not_implemented"
  RateLimited _ -> "rate_limited"
  SearchTimeout _ -> "search_timeout"
  InvalidRequest _ -> "invalid_request"
  Unauthenticated _ -> "unauthenticated"
  SessionExpired _ -> "session_expired"
  ProfileUnavailable _ -> "profile_unavailable"
  NetworkError _ -> "network"
  InvalidResponse _ -> "invalid_response"
  _ -> "error"

-- | The failure of a search as one short line. A 501 is "not implemented", never a partial or empty result.
searchErrorText :: ApiError -> String
searchErrorText = case _ of
  NotImplemented _ -> "投稿検索はまだ使えません"
  RateLimited _ -> "リクエストが多すぎます。しばらくしてからもう一度"
  SearchTimeout _ -> "検索がタイムアウトしました"
  InvalidRequest _ -> "この条件では検索できません"
  Unauthenticated _ -> "ログインが必要です"
  SessionExpired _ -> "ログインの有効期限が切れました"
  ProfileUnavailable _ -> "Profile を選択してください"
  NetworkError _ -> "通信に失敗しました"
  _ -> "検索できませんでした"
