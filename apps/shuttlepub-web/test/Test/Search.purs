-- | Post search (D04) rules and state transitions (App.Search.Update), checked on the model.
-- | Effects (requests, focus, timers) are not run here; their outcome messages are fed back by
-- | hand, as the runtime would.
module Test.Search (testSearch) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Message as App
import App.Model (RemoteData(..), initialModel)
import App.Route (Route(..), routeCodec, searchHome)
import App.Search.Dom (highlightSegments)
import App.Search.Text (authorHandle, authorInitial, authorName, keyword, lastFrom, parse, spaceConversion, suggestionPrefix)
import App.Search.Types (Author, Condition, Message(..), Note, NoteKind(..), Problem(..), Results(..), Tail(..))
import App.Search.Types as Search
import App.Search.Update as SearchUpdate
import App.View (view)
import Data.Array (filter, length)
import Data.Either (Either(..), hush)
import Data.Maybe (Maybe(..))
import Data.String (Pattern(..), contains, split)
import Data.Tuple (Tuple(..))
import Data.String.Common (joinWith)
import Client.Update (mkUpdate)
import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)
import Flame.Renderer.String as FRS
import Generated.Schema.Gql.Enum.ApiMode (ApiMode(..))
import Routing.Duplex (parse, print) as Routing
import Server (renderPage)
import Unsafe.Coerce (unsafeCoerce)

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual label actual expected =
  unless (actual == expected) (throw (label <> " - expected " <> show expected <> ", got " <> show actual))

assertTrue :: String -> Boolean -> Effect Unit
assertTrue label ok = assertEqual label ok true

assertContains :: String -> String -> String -> Effect Unit
assertContains label haystack needle =
  assertTrue (label <> " contains " <> show needle) (contains (Pattern needle) haystack)

assertNotContains :: String -> String -> String -> Effect Unit
assertNotContains label haystack needle =
  assertTrue (label <> " does not contain " <> show needle) (not (contains (Pattern needle) haystack))

alice :: Author
alice = { actorUrl: "https://shuttle.example/users/alice", acct: "alice@shuttle.example", displayName: Just "Alice" }

bob :: Author
bob = { actorUrl: "https://mstdn.example/users/bob", acct: "bob@mstdn.example", displayName: Nothing }

note :: String -> Note
note id =
  { id
  , kind: PostKind
  , authorActorUrl: alice.actorUrl
  , createdAt: "2026-01-01T00:00:00Z"
  , text: Just ("text " <> id)
  , contentWarning: Nothing
  }

-- | A screen shown for a Profile with no condition yet.
shown :: Search.Model
shown = (SearchUpdate.enter (Just "profile-1") Search.emptyCondition Search.init).model

step :: Search.Model -> Message -> { next :: Search.Model, effects :: Int, commit :: Maybe Condition }
step model message =
  let
    result = SearchUpdate.update model message
  in
    { next: result.model, effects: length result.effects, commit: result.commit }

typedInto :: Search.Model -> String -> Search.Model
typedInto model text = (step model (InputChanged text)).next

found :: Array Note -> Tail -> Search.Model
found notes tail = shown { results = Found notes tail, condition = { q: Just "ZINE", author: Nothing } }

testSearch :: Effect Unit
testSearch = do
  log "  post search"
  testTextRules
  testBoxRules
  testStaleAnswers
  testPaging
  testHighlight
  testScreen

testTextRules :: Effect Unit
testTextRules = do
  let parsed = Routing.parse routeCodec "/search?q=%E6%A4%9C%E7%B4%A2&from=https%3A%2F%2Fa.example%2Fusers%2Fx"
  assertEqual "the condition is read from the URL" (hush parsed)
    (Just (Search { q: Just "検索", from: Just "https://a.example/users/x" }))
  assertEqual "the condition is printed to the URL (no cursor)"
    (Routing.print routeCodec (Search { q: Just "検索", from: Just "https://a.example/users/x" }))
    "/search?q=%E6%A4%9C%E7%B4%A2&from=https%3A%2F%2Fa.example%2Fusers%2Fx"
  assertEqual "no condition prints the bare path" (Routing.print routeCodec searchHome) "/search"
  assertEqual "from is taken out of the keyword" (keyword (parse "foo from:@alice bar")) "foo bar"
  assertEqual "FROM is case-insensitive" (lastFrom (parse "FROM:@Alice")) (Just "Alice")
  assertEqual "the second from replaces the first" (lastFrom (parse "from:@a from:@b@x.example")) (Just "b@x.example")
  assertEqual "a trailing space finishes the token" (spaceConversion (parse "from:@alice ")) (Just "alice")
  assertEqual "no space, no conversion" (spaceConversion (parse "from:@alice")) Nothing
  assertEqual "an ideographic space finishes it too" (spaceConversion (parse "from:@alice\x3000")) (Just "alice")
  assertEqual "suggestions follow the typed token" (suggestionPrefix (parse "foo from:@al")) (Just "al")
  assertEqual "bare from:@ asks nothing" (suggestionPrefix (parse "from:@")) Nothing
  assertEqual "a finished token asks nothing" (suggestionPrefix (parse "from:@al ")) Nothing
  -- Names follow the D08 rule: display name, then @acct, then the actor URL; nothing from the URL.
  assertEqual "display name first" (authorName alice) "Alice"
  assertEqual "then @acct" (authorName bob) "@bob@mstdn.example"
  assertEqual "then the actor URL" (authorName { actorUrl: "https://x.example/u/1", acct: "", displayName: Nothing }) "https://x.example/u/1"
  assertEqual "the chip handle is the user part" (authorHandle bob) "@bob"
  assertEqual "the placeholder icon letter" (authorInitial alice) "A"
  assertEqual "an author known only by the URL has no letter to guess" (authorInitial { actorUrl: "https://x.example/u/1", acct: "", displayName: Nothing }) "?"
  assertEqual "an emoji name is one letter, not half a surrogate" (authorInitial { actorUrl: "u", acct: "", displayName: Just "🎉party" }) "🎉"

testBoxRules :: Effect Unit
testBoxRules = do
  -- Enter on text without from: searches the keyword at once.
  let typed = typedInto shown "ZINE"
  let enter = step typed EnterPressed
  assertEqual "Enter searches" enter.commit (Just { q: Just "ZINE", author: Nothing })
  assertEqual "an empty box does not search" (step shown EnterPressed).commit Nothing
  -- A space after from:@acct only converts: it resolves and searches nothing.
  let spaced = step shown (InputChanged "from:@alice ")
  assertEqual "space resolves" spaced.effects 1
  assertTrue "space is waiting for the resolve" (spaced.next.resolving /= Nothing)
  assertEqual "space does not search" spaced.commit Nothing
  let done = step spaced.next (ResolveDone spaced.next.gen (unsafeResolving spaced.next) false (Right alice))
  assertEqual "the chip replaces the text" done.next.author (Just alice)
  assertEqual "the from text is gone" done.next.input ""
  assertEqual "converting by space does not search" done.commit Nothing
  -- Enter on from:@acct converts and then searches.
  let entering = step (typedInto shown "ZINE from:@alice") EnterPressed
  assertEqual "Enter resolves first" entering.effects 1
  assertEqual "Enter does not search before the author is known" entering.commit Nothing
  let entered = step entering.next (ResolveDone entering.next.gen (unsafeResolving entering.next) true (Right alice))
  assertEqual "then it searches the keyword and the author" entered.commit (Just { q: Just "ZINE", author: Just alice.actorUrl })
  -- Host omitted: the acct goes to the server as typed (the server's own host, not the browser's).
  assertEqual "the typed acct is kept as is" (lastFrom (parse "from:@alice")) (Just "alice")
  -- A second from replaces the chip.
  let withChip = shown { author = Just alice }
  let replacing = step (typedInto withChip "from:@bob@mstdn.example ") (InputChanged "from:@bob@mstdn.example ")
  let replaced = step replacing.next (ResolveDone replacing.next.gen (unsafeResolving replacing.next) false (Right bob))
  assertEqual "the second from replaces the first" replaced.next.author (Just bob)
  -- Failure keeps the text, shows a short error and never searches.
  let failing = step (typedInto shown "from:@ghost") EnterPressed
  let failed = step failing.next (ResolveDone failing.next.gen (unsafeResolving failing.next) true (Left (SearchNotFound "no such")))
  assertEqual "the text stays" failed.next.input "from:@ghost"
  assertEqual "no author on failure" failed.next.author Nothing
  assertEqual "no search on failure" failed.commit Nothing
  assertEqual "short error" failed.next.problem (Just (NotFound "ghost"))
  let ambiguous = step failing.next (ResolveDone failing.next.gen (unsafeResolving failing.next) true (Left (AuthorAmbiguous "dup")))
  assertEqual "an ambiguous author is not a conflict of a reaction" ambiguous.next.problem (Just (Ambiguous "ghost"))
  let limited = step failing.next (ResolveDone failing.next.gen (unsafeResolving failing.next) true (Left (RateLimited "slow")))
  assertEqual "429 is told as such" limited.next.problem (Just (LookupFailed (RateLimited "slow")))
  assertEqual "typing again clears the error" (typedInto failed.next "from:@ghos").problem Nothing
  -- A suggestion is chosen by its own actor URL: nothing is resolved, nothing is searched.
  let withSuggestions = shown { suggest = shown.suggest { open = true, items = [ alice, bob ] }, input = "from:@a" }
  let picked = step withSuggestions (PickSuggestion 1)
  assertEqual "pick sets the author by actor URL" picked.next.author (Just bob)
  assertEqual "pick does not resolve" picked.next.resolving Nothing
  assertEqual "pick does not search" picked.commit Nothing
  assertEqual "pick takes the from text out" picked.next.input ""
  let moved = (step withSuggestions (MoveActive 1)).next
  assertEqual "arrow down enters the list" moved.suggest.active (Just 0)
  assertEqual "arrow up wraps" (step moved (MoveActive (-1))).next.suggest.active (Just 1)
  let activePicked = step moved EnterPressed
  assertEqual "Enter on the active option picks it" activePicked.next.author (Just alice)
  assertEqual "and does not search" activePicked.commit Nothing
  assertEqual "Escape closes the list" (step withSuggestions CloseSuggestions).next.suggest.open false
  -- IME: while composing nothing converts, resolves or asks for suggestions.
  let composing = (step shown CompositionStarted).next
  let midway = step composing (InputChanged "from:@あ ")
  assertEqual "no resolve while composing" midway.effects 0
  assertEqual "no conversion while composing" midway.next.resolving Nothing
  assertEqual "the text is kept while composing" midway.next.input "from:@あ "
  assertEqual "composition end converts by the final text" (step midway.next (CompositionEnded "from:@alice ")).effects 1
  -- Backspace at the start removes the chip; the clear button leaves nothing.
  assertEqual "backspace at the start removes the chip" (step withChip BackspaceAtStart).next.author Nothing
  assertEqual "backspace without a chip does nothing" (step shown BackspaceAtStart).effects 0
  let cleared = step (withChip { input = "x" }) ClearAll
  assertEqual "clear empties the box" cleared.next.input ""
  assertEqual "clear removes the author" cleared.next.author Nothing
  assertEqual "clear commits the empty condition" cleared.commit (Just Search.emptyCondition)
  -- Only an author: allowed (the profile entry), keyword only: allowed.
  let authorOnly = step withChip EnterPressed
  assertEqual "author only is searchable" authorOnly.commit (Just { q: Nothing, author: Just alice.actorUrl })

unsafeResolving :: Search.Model -> Int
unsafeResolving model = case model.resolving of
  Just seq -> seq
  Nothing -> -1

testStaleAnswers :: Effect Unit
testStaleAnswers = do
  -- A new condition is a new generation: the older search's answer is dropped.
  let first = SearchUpdate.enter (Just "profile-1") { q: Just "old", author: Nothing } Search.init
  let second = SearchUpdate.enter (Just "profile-1") { q: Just "new", author: Nothing } first.model
  assertEqual "entering searches" (length first.effects) 1
  assertEqual "a new condition is a new generation" (second.model.gen /= first.model.gen) true
  let late = step second.model (SearchLoaded first.model.gen (Right { notes: [ note "old-1" ], truncated: false, nextCursor: Nothing }))
  assertEqual "the old answer is dropped" late.next.results Searching
  let current = step second.model (SearchLoaded second.model.gen (Right { notes: [ note "new-1" ], truncated: false, nextCursor: Nothing }))
  assertEqual "the current answer is taken" current.next.results (Found [ note "new-1" ] End)
  assertEqual "an answer is taken once" (step current.next (SearchLoaded second.model.gen (Right { notes: [ note "x" ], truncated: false, nextCursor: Nothing }))).next.results current.next.results
  -- Another Profile starts over; the old Profile's answer never lands.
  let other = SearchUpdate.enter (Just "profile-2") { q: Just "new", author: Nothing } second.model
  assertEqual "another Profile drops the old answer"
    (step other.model (SearchLoaded second.model.gen (Right { notes: [ note "p1" ], truncated: false, nextCursor: Nothing }))).next.results
    Searching
  -- Suggestions and resolves answer only the request the box still waits for.
  let typing = step shown (InputChanged "from:@al")
  let seq1 = typing.next.suggest.seq
  let again = step typing.next (InputChanged "from:@ali")
  assertTrue "typing makes a newer request" (again.next.suggest.seq /= seq1)
  assertEqual "the older suggestions are dropped"
    (step again.next (SuggestionsLoaded again.next.gen seq1 (Right [ alice ]))).next.suggest.items
    []
  assertEqual "the older due timer asks nothing" (step again.next (SuggestDue again.next.gen seq1 "al")).effects 0
  assertEqual "the newer timer asks" (step again.next (SuggestDue again.next.gen again.next.suggest.seq "ali")).effects 1
  assertEqual "the newer suggestions are shown"
    (step again.next (SuggestionsLoaded again.next.gen again.next.suggest.seq (Right [ alice ]))).next.suggest.items
    [ alice ]
  assertEqual "a suggestion answer of another Profile is dropped"
    (step other.model (SuggestionsLoaded second.model.gen 0 (Right [ alice ]))).next.suggest.items
    []
  let resolving = step (typedInto shown "from:@alice") EnterPressed
  let typedAgain = typedInto resolving.next "from:@alic"
  assertEqual "a resolve cancelled by typing is dropped"
    (step typedAgain (ResolveDone resolving.next.gen (unsafeResolving resolving.next) true (Right alice))).next.author
    Nothing
  -- An IME that starts composing cancels the resolve (success and failure answers are dropped), and
  -- nothing new is asked while composing.
  let composing = step resolving.next CompositionStarted
  assertEqual "composition cancels the resolve" composing.next.resolving Nothing
  assertEqual "composition asks nothing" composing.effects 0
  assertEqual "a success after composition started is dropped"
    (step composing.next (ResolveDone resolving.next.gen (unsafeResolving resolving.next) true (Right alice))).next.author
    Nothing
  assertEqual "a success after composition started does not search"
    (step composing.next (ResolveDone resolving.next.gen (unsafeResolving resolving.next) true (Right alice))).commit
    Nothing
  assertEqual "a failure after composition started shows no error"
    (step composing.next (ResolveDone resolving.next.gen (unsafeResolving resolving.next) true (Left (SearchNotFound "x")))).next.problem
    Nothing
  let composingText = step composing.next (InputChanged "from:@あ")
  assertEqual "typing while composing asks nothing" composingText.effects 0
  assertEqual "typing while composing resolves nothing" composingText.next.resolving Nothing
  -- Leaving the screen while a resolve is in flight: the late answer must not bring /search back.
  let
    update = mkUpdate (unsafeCoerce unit)
    onSearch = (initialModel (Just searchHome)) { isHydrated = true, search = resolving.next }
    leftSearch = case update onSearch (App.UrlChanged (Just Home)) of
      Tuple model _ -> model
    afterLate = case update leftSearch (App.SearchMsg (ResolveDone resolving.next.gen (unsafeResolving resolving.next) true (Right alice))) of
      Tuple model effects -> { model, effects: length effects }
  assertEqual "leaving search drops the request" (leftSearch.search.resolving) Nothing
  assertEqual "the late resolve does not navigate (no effect)" afterLate.effects 0
  assertEqual "the late resolve keeps the screen" afterLate.model.route (Just Home)
  assertEqual "the late resolve leaves no author" afterLate.model.search.author Nothing
  assertEqual "a late search message on another screen is ignored"
    ( case update leftSearch (App.SearchMsg (SearchLoaded 0 (Right { notes: [ note "z" ], truncated: false, nextCursor: Nothing }))) of
        Tuple model _ -> model.search.results
    )
    Idle
  assertEqual "a failed lookup keeps the box and makes no result"
    (SearchUpdate.failed (NotImplemented "x") { q: Just "a", author: Nothing } shown).results
    (SearchFailed (NotImplemented "x"))

testPaging :: Effect Unit
testPaging = do
  let withNext = found [ note "a", note "b" ] (Next "c1")
  let loading = step withNext SentinelSeen
  assertEqual "the sentinel loads the next page" loading.effects 1
  assertEqual "while loading" loading.next.results (Found [ note "a", note "b" ] (LoadingNext "c1"))
  assertEqual "no second load while one is in flight" (step loading.next SentinelSeen).effects 0
  assertEqual "no manual second load either" (step loading.next LoadMore).effects 0
  let appended = step loading.next (MoreLoaded loading.next.gen "c1" (Right { notes: [ note "b", note "c" ], truncated: false, nextCursor: Nothing }))
  assertEqual "a repeated note is not added twice and the end is reached" appended.next.results (Found [ note "a", note "b", note "c" ] End)
  assertEqual "nothing loads at the end" (step appended.next SentinelSeen).effects 0
  assertEqual "an answer for another cursor is dropped" (step loading.next (MoreLoaded loading.next.gen "other" (Right { notes: [ note "z" ], truncated: false, nextCursor: Nothing }))).next.results loading.next.results
  assertEqual "an answer of an older generation is dropped" (step loading.next (MoreLoaded (loading.next.gen - 1) "c1" (Right { notes: [ note "z" ], truncated: false, nextCursor: Nothing }))).next.results loading.next.results
  let chained = step loading.next (MoreLoaded loading.next.gen "c1" (Right { notes: [ note "c" ], truncated: false, nextCursor: Just "c2" }))
  assertEqual "the cursor moves on" chained.next.results (Found [ note "a", note "b", note "c" ] (Next "c2"))
  -- A failed page keeps what is shown and waits for its button (never loops by itself).
  let broken = step loading.next (MoreLoaded loading.next.gen "c1" (Left (NetworkError "down")))
  assertEqual "failed page keeps the notes" broken.next.results (Found [ note "a", note "b" ] (NextFailed "c1" (NetworkError "down")))
  assertEqual "a failed page does not load by itself" (step broken.next SentinelSeen).effects 0
  assertEqual "the button retries from the same cursor" (step broken.next LoadMore).effects 1
  -- Time limit (d04-q17): the partial result stays, nothing loads by itself, the button resumes.
  let cut = step (shown { results = Searching, condition = { q: Just "時間切れ", author: Nothing } }) (SearchLoaded shown.gen (Right { notes: [ note "a" ], truncated: true, nextCursor: Just "t1" }))
  assertEqual "the partial result is kept" cut.next.results (Found [ note "a" ] (Interrupted "t1"))
  assertEqual "an interrupted search does not load by itself" (step cut.next SentinelSeen).effects 0
  let resumed = step cut.next LoadMore
  assertEqual "the button resumes from next_cursor" resumed.next.results (Found [ note "a" ] (LoadingNext "t1"))
  assertEqual "resuming asks once" resumed.effects 1
  let cutAgain = step resumed.next (MoreLoaded resumed.next.gen "t1" (Right { notes: [ note "b" ], truncated: true, nextCursor: Just "t2" }))
  assertEqual "it can be interrupted again" cutAgain.next.results (Found [ note "a", note "b" ] (Interrupted "t2"))
  -- After an interruption the rest stays manual until a new condition is confirmed (d04-q17).
  let resumedOk = step resumed.next (MoreLoaded resumed.next.gen "t1" (Right { notes: [ note "b" ], truncated: false, nextCursor: Just "t2" }))
  assertEqual "a page that ends in time still waits for the button" resumedOk.next.results (Found [ note "a", note "b" ] (Interrupted "t2"))
  assertEqual "and does not load by itself" (step resumedOk.next SentinelSeen).effects 0
  let resumedTwice = step (step resumedOk.next LoadMore).next (MoreLoaded resumedOk.next.gen "t2" (Right { notes: [ note "c" ], truncated: false, nextCursor: Just "t3" }))
  assertEqual "it stays manual page after page" resumedTwice.next.results (Found [ note "a", note "b", note "c" ] (Interrupted "t3"))
  let resumedEnd = step (step resumedOk.next LoadMore).next (MoreLoaded resumedOk.next.gen "t2" (Right { notes: [ note "c" ], truncated: false, nextCursor: Nothing }))
  assertEqual "the end is the end" resumedEnd.next.results (Found [ note "a", note "b", note "c" ] End)
  let failedMore = step resumed.next (MoreLoaded resumed.next.gen "t1" (Left (NetworkError "down")))
  let afterFail = step (step failedMore.next LoadMore).next (MoreLoaded failedMore.next.gen "t1" (Right { notes: [ note "b" ], truncated: false, nextCursor: Just "t2" }))
  assertEqual "a failed page then a success is still manual" afterFail.next.results (Found [ note "a", note "b" ] (Interrupted "t2"))
  let newCondition = SearchUpdate.enter (Just "profile-1") { q: Just "other", author: Nothing } resumedOk.next
  assertEqual "a new condition leaves manual mode" newCondition.model.manual false
  let ordinary = step newCondition.model (SearchLoaded newCondition.model.gen (Right { notes: [ note "n" ], truncated: false, nextCursor: Just "n1" }))
  assertEqual "and loads by itself again" ordinary.next.results (Found [ note "n" ] (Next "n1"))
  -- An error or a 501 is never turned into a partial or empty result.
  let failedFirst = step (shown { results = Searching }) (SearchLoaded shown.gen (Left (NotImplemented "501")))
  assertEqual "501 is its own state" failedFirst.next.results (SearchFailed (NotImplemented "501"))
  assertEqual "retry searches again" (step failedFirst.next Retry).effects 1
  -- A new condition resets the cursor and the results.
  let reset = SearchUpdate.enter (Just "profile-1") { q: Just "other", author: Nothing } withNext
  assertEqual "a condition change resets the results" reset.model.results Searching
  assertEqual "and starts a new generation" (reset.model.gen /= withNext.gen) true

testHighlight :: Effect Unit
testHighlight = do
  let texts segments = map _.text segments
  let hits segments = map _.text (filter _.hit segments)
  assertEqual "no keyword, no hit" (hits (highlightSegments "" "abc")) []
  assertEqual "Japanese" (hits (highlightSegments "検索" "投稿の検索と検索")) [ "検索", "検索" ]
  assertEqual "pieces rebuild the text" (joinWith "" (texts (highlightSegments "検索" "投稿の検索と検索"))) "投稿の検索と検索"
  assertEqual "width is folded" (hits (highlightSegments "zine" "ｚｉｎｅ")) [ "ｚｉｎｅ" ]
  assertEqual "case-insensitive" (hits (highlightSegments "zine" "A ZiNe b")) [ "ZiNe" ]
  assertEqual "emoji is whole" (hits (highlightSegments "🎉" "a🎉b🎉")) [ "🎉", "🎉" ]
  assertEqual "markup is plain text" (hits (highlightSegments "b" "<b>x</b> & \"b\"")) [ "b", "b", "b" ]
  assertEqual "markup stays in its pieces" (joinWith "" (texts (highlightSegments "script" "<script>alert(1)</script>"))) "<script>alert(1)</script>"
  -- The same rule as the mock (NFKC + lowercase of the whole keyword); a match maps back to the original text.
  assertEqual "several words are one substring" (hits (highlightSegments "foo bar" "bar and foo")) []
  assertEqual "the substring of several words" (hits (highlightSegments "foo bar" "x foo bar y")) [ "foo bar" ]
  assertEqual "half-width kana with a mark" (hits (highlightSegments "ガ" "あｶﾞい")) [ "ｶﾞ" ]
  assertEqual "full-width kana finds half-width keyword" (hits (highlightSegments "ｶﾞ" "あガい")) [ "ガ" ]
  assertEqual "ligature" (hits (highlightSegments "ff" "a\xFB00 b")) [ "\xFB00" ]
  assertEqual "composed keyword, decomposed text" (hits (highlightSegments "\xE9" "ae\x0301 b")) [ "e\x0301" ]
  assertEqual "decomposed keyword, composed text" (hits (highlightSegments "e\x0301" "a\xE9 b")) [ "\xE9" ]
  -- Context-dependent folding follows the whole-text rule (final sigma, Hangul jamo), as the mock does.
  assertEqual "final sigma: the whole text decides" (hits (highlightSegments "\x03BF\x03C2" "\x039F\x03A3")) [ "\x039F\x03A3" ]
  assertEqual "final sigma: no match where the mock has none" (hits (highlightSegments "\x03BF\x03C3" "\x039F\x03A3")) []
  assertEqual "Hangul jamo compose" (hits (highlightSegments "\xAC00" "a \x1100\x1161 b")) [ "\x1100\x1161" ]
  assertEqual "Hangul syllable finds jamo text only as the mock does" (hits (highlightSegments "\x1100\x1161" "a \xAC00 b")) [ "\xAC00" ]
  -- Context-dependent folding reaches only the characters it joins: the rest of the text keeps its own marks.
  assertEqual "CJK keyword, sigma later in the text" (hits (highlightSegments "検索" "検索結果を説明するΟΣ")) [ "検索" ]
  assertEqual "Hangul keyword, composed, amid CJK" (hits (highlightSegments "\xAC00" "前\x1100\x1161後")) [ "\x1100\x1161" ]
  assertEqual "Hangul keyword, jamo, amid CJK" (hits (highlightSegments "\x1100\x1161" "前\xAC00後")) [ "\xAC00" ]
  assertEqual "a plain letter before a sigma word" (hits (highlightSegments "a" "abc ΟΣ def")) [ "a" ]
  assertEqual "a sigma word is one piece when it matches" (hits (highlightSegments "ος" "x ΟΣ y")) [ "ΟΣ" ]
  assertEqual "a letter after the sigma word is not marked" (hits (highlightSegments "y" "x ΟΣ y")) [ "y" ]
  assertEqual "emoji and CJK around a sigma word" (hits (highlightSegments "🎉" "🎉検索ΟΣ🎉")) [ "🎉", "🎉" ]
  assertEqual "pieces rebuild a mixed text" (joinWith "" (texts (highlightSegments "検索" "検索結果を説明するΟΣ"))) "検索結果を説明するΟΣ"
  assertEqual "pieces rebuild the folded text" (joinWith "" (texts (highlightSegments "ガ" "あｶﾞい"))) "あｶﾞい"
  assertEqual "no match, one piece" (length (highlightSegments "zzz" "abc")) 1

testScreen :: Effect Unit
testScreen = do
  -- SSR shows the URL's condition in the box and the chip, and claims no results.
  page <- renderPage "/search?q=ZINE&from=https%3A%2F%2Fshuttle.example%2Fusers%2Falice"
  assertContains "SSR search box" page "data-testid=\"search-input\""
  assertContains "SSR keeps the keyword" page "value=\"ZINE\""
  assertContains "SSR shows the author chip" page "data-actor-url=\"https://shuttle.example/users/alice\""
  assertNotContains "SSR has no notes" page "data-testid=\"search-note\""
  assertNotContains "SSR has no placeholder text" page "まだ実装されていません"
  bare <- renderPage "/search"
  assertContains "bare search" bare "role=\"combobox\""
  assertNotContains "bare search has no chip" bare "author-chip"
  assertNotContains "no always-on add-author button" bare "投稿者を追加"
  let base = (initialModel (Just (Search { q: Just "ZINE", from: Nothing }))) { isHydrated = true, apiMode = Loaded REAL }
  html <- FRS.render (view (base { search = (found [ cardNote "n1" "<b>ZINE</b> 🎉 検索", cwNote ] End) { known = [ alice ] } }))
  assertContains "a hit is a mark element" html "<mark"
  assertContains "text is escaped, not markup" html "&lt;b&gt;"
  assertNotContains "no raw markup from a note" html "<b>ZINE"
  assertContains "the content warning is folded" html "<details"
  assertContains "the author is named" html "Alice"
  assertContains "the end is marked for the tests" html "data-tail=\"end\""
  assertNotContains "nothing is said at the end" html "ここまで"
  assertNotContains "no end element" html "search-end"
  assertNotContains "no avatar image" html "<img"
  let cut = (found [ note "a" ] (Interrupted "t1")) { known = [ alice ] }
  cutHtml <- FRS.render (view (base { search = cut }))
  assertContains "interrupted notice" cutHtml "ここまでで中断しました"
  assertContains "continue button" cutHtml "途中から続きを読む"
  assertNotContains "no sentinel while interrupted" cutHtml "data-search-sentinel"
  nextHtml <- FRS.render (view (base { search = found [ note "a" ] (Next "c1") }))
  assertContains "the sentinel exists while it loads by itself" nextHtml "data-search-sentinel=\"c1\""
  empty <- FRS.render (view (base { search = found [] End }))
  assertContains "zero results" empty "見つかりませんでした"
  assertContains "zero results has its own marker" empty "data-testid=\"search-empty\""
  assertNotContains "zero results is not the time-limit message" empty "時間内に見つかりませんでした"
  assertNotContains "zero results says nothing about the end" empty "ここまで"
  timedOut <- FRS.render (view (base { search = found [] (Interrupted "t1") }))
  assertContains "time-limit zero results" timedOut "時間内に見つかりませんでした"
  assertContains "time-limit zero results has its own marker" timedOut "data-testid=\"search-empty-timeout\""
  assertNotContains "time-limit zero results is not the plain zero" timedOut "data-testid=\"search-empty\""
  assertContains "the time-limit zero state still resumes" timedOut "途中から続きを読む"
  assertNotContains "no interrupted notice without notes" timedOut "ここまでで中断しました"
  loadingNext <- FRS.render (view (base { search = found [ note "a" ] (LoadingNext "c1") }))
  assertContains "the next page shows post skeletons" loadingNext "data-testid=\"search-skeleton\""
  assertNotContains "the next page has no spinner text" loadingNext "読み込み中…"
  searching <- FRS.render (view (base { search = shown { results = Searching } }))
  assertContains "the first search is a status region" searching "role=\"status\""
  assertContains "and says it is searching" searching "検索中"
  assertContains "the status region has its marker" searching "data-testid=\"search-status\""
  assertNotContains "searching is not an alert" searching "role=\"alert\""
  assertEqual "the first search shows three skeletons" (length (split (Pattern "sp-search-note-skeleton") searching) - 1) 3
  notImplemented <- FRS.render (view (base { search = shown { results = SearchFailed (NotImplemented "501") } }))
  assertContains "501 is a short unimplemented notice" notImplemented "投稿検索はまだ使えません"
  assertNotContains "501 is not shown as zero results" notImplemented "見つかりませんでした"
  failedNext <- FRS.render (view (base { search = found [ note "a" ] (NextFailed "c1" (NetworkError "down")) }))
  assertContains "a failed page" failedNext "読み込めませんでした"
  assertContains "a failed page is a status region" failedNext "role=\"status\""
  assertNotContains "a failed page is not an alert" failedNext "role=\"alert\""
  failedFirst <- FRS.render (view (base { search = shown { results = SearchFailed (NetworkError "down") } }))
  assertContains "a failed search says so" failedFirst "読み込めませんでした"
  assertContains "a failed search is a status region" failedFirst "role=\"status\""
  assertNotContains "a failed search is not an alert" failedFirst "role=\"alert\""
  assertContains "a failed search retries" failedFirst "data-testid=\"search-retry\""
  assertContains "a failed page retries" failedNext "再試行"
  marked <- FRS.render (view (base { search = (shown { input = "from:@al" }) { suggest = Search.emptySuggestions { open = true, items = [ alice ] } } }))
  assertContains "the typed prefix is marked in a suggestion" marked "data-testid=\"search-suggest-hit\""
  chipped <- FRS.render (view (base { search = shown { author = Just alice, flash = 1 } }))
  assertContains "the new chip is highlighted" chipped "is-just-a"
  assertContains "the chip is named in full" chipped "Alice @alice@shuttle.example"
  plainChip <- FRS.render (view (base { search = shown { author = Just alice } }))
  assertNotContains "a chip that was not just made is not highlighted" plainChip "is-just-"
  assertContains "the field has the agreed placeholder" plainChip "placeholder=\"検索\""
  where
  cardNote id text = (note id) { text = Just text }
  cwNote = (note "n2") { contentWarning = Just "ネタバレ ZINE", text = Just "本文" }
