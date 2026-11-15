-- | Update of the post search screen (D04). Pure state transitions plus the requests they start.
-- |
-- | Rules this module keeps (ui-spec 実装上の注意):
-- |  - the condition (keyword and author) is held apart; the text `from:@…` is never sent as a keyword;
-- |  - a suggestion is chosen by its returned actor URL and is never resolved again; only text typed by
-- |    hand is resolved, and when it cannot be, the text stays, a short error shows and nothing is searched;
-- |  - choosing a suggestion or typing a space only converts; Enter converts and then searches;
-- |  - an answer of an older generation (condition, Profile, screen) or an older request is dropped;
-- |  - only `Next` loads by itself; an interrupted search and a failed page wait for their button.
module App.Search.Update
  ( Step
  , update
  , enter
  , conditionOf
  , isActive
  , clearState
  , failed
  ) where

import Prelude

import App.Api.Error (ApiError(..))
import App.Dom (focusById)
import App.Search.Api (resolveAuthor, searchNotes, suggestAuthors)
import App.Search.Text (keyword, knownAuthor, lastFrom, parse, rememberAuthor, spaceConversion, suggestionPrefix, withoutFrom)
import App.Search.Types (Author, Condition, Message(..), Model, Note, Page, Problem(..), Results(..), Tail(..), emptyCondition, emptySuggestions, searchInputId)
import Data.Array (any, foldl, length, snoc, (!!))
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), isJust, isNothing)
import Data.Time.Duration (Milliseconds(..))
import Effect.Aff (Aff, delay)
import Effect.Class (liftEffect)

-- | `commit` asks the screen to make a condition the URL's (and then to search it).
type Step =
  { model :: Model
  , effects :: Array (Aff (Maybe Message))
  , commit :: Maybe Condition
  }

stay :: Model -> Step
stay model = { model, effects: [], commit: Nothing }

withEffects :: Array (Aff (Maybe Message)) -> Model -> Step
withEffects effects model = { model, effects, commit: Nothing }

focusInput :: Aff (Maybe Message)
focusInput = liftEffect (focusById searchInputId) $> Nothing

-- | The condition a search of the box would confirm now.
conditionOf :: Model -> Condition
conditionOf model =
  { q: nonEmpty (keyword (parse model.input))
  , author: map _.actorUrl model.author
  }
  where
  nonEmpty text = if text == "" then Nothing else Just text

isActive :: Condition -> Boolean
isActive condition = isJust condition.q || isJust condition.author

-- | The state a screen that is left or a Profile that went away must not keep: the box, the
-- | results and every request in flight (their answers carry the old generation).
clearState :: Model -> Model
clearState model = model
  { gen = model.gen + 1
  , input = ""
  , composing = false
  , author = Nothing
  , condition = emptyCondition
  , suggest = emptySuggestions
  , resolving = Nothing
  , problem = Nothing
  , results = Idle
  , waiting = false
  }

-- | The screen is shown for this condition (the URL's) and this Profile context (Nothing while
-- | it is not known): the box shows the condition and it is searched. A new generation starts, so
-- | whatever was in flight for another condition or Profile is dropped.
enter :: Maybe String -> Condition -> Model -> Step
enter profile condition model = case profile of
  Nothing -> stay (base { waiting = isActive condition })
  Just _ | isActive condition -> withEffects [ fetchFirst base ] (base { results = Searching })
  Just _ -> stay base
  where
  base = (clearState model)
    { profile = profile
    -- Names learned for one Profile (its suggestions leave out what it mutes) are not carried to another.
    , known = if isNothing model.profile || model.profile == profile then model.known else []
    , input = fromMaybeText condition.q
    , author = map (knownAuthor (if isNothing model.profile || model.profile == profile then model.known else [])) condition.author
    , condition = condition
    , waiting = isNothing profile && isActive condition
    }
  fromMaybeText = case _ of
    Just text -> text
    Nothing -> ""

-- | The screen is shown but there is no Profile to search for (the context failed, or none is selected):
-- | the box shows the condition and the search is an error, never an empty result.
failed :: ApiError -> Condition -> Model -> Model
failed error condition model = (clearState model)
  { profile = Nothing
  , input = case condition.q of
      Just text -> text
      Nothing -> ""
  , author = map (knownAuthor model.known) condition.author
  , condition = condition
  , results = if isActive condition then SearchFailed error else Idle
  }

fetchFirst :: Model -> Aff (Maybe Message)
fetchFirst model = case model.profile of
  Just profile -> Just <<< SearchLoaded model.gen <$> searchNotes profile model.condition Nothing
  Nothing -> pure Nothing

nextSeq :: Model -> { model :: Model, seq :: Int }
nextSeq model = { model: model { seqCounter = model.seqCounter + 1 }, seq: model.seqCounter + 1 }

closeSuggestions :: Model -> Model
closeSuggestions model =
  let
    next = nextSeq model
  in
    next.model { suggest = emptySuggestions { seq = next.seq } }

update :: Model -> Message -> Step
update model = case _ of
  InputChanged text
    | model.composing -> stay (model { input = text })
    | otherwise -> typed text model
  CompositionStarted -> stay (model { composing = true })
  CompositionEnded text -> typed text (model { composing = false })

  EnterPressed -> case model.suggest.active >>= \index -> model.suggest.items !! index of
    Just author | model.suggest.open -> pick author model
    _ -> case lastFrom (parse model.input) of
      Just acct -> resolve acct true model
      Nothing ->
        let
          condition = conditionOf model
        in
          if isActive condition then (stay (closeSuggestions model)) { commit = Just condition } else stay (closeSuggestions model)

  MoveActive step
    | model.suggest.open && length model.suggest.items > 0 ->
        let
          count = length model.suggest.items
          index = case model.suggest.active of
            Nothing -> if step > 0 then 0 else count - 1
            Just current -> (current + step + count) `mod` count
        in
          stay (model { suggest = model.suggest { active = Just index } })
    | otherwise -> stay model

  PickSuggestion index -> case model.suggest.items !! index of
    Just author -> pick author model
    Nothing -> stay model

  BackspaceAtStart
    | isJust model.author -> removeAuthor model
    | otherwise -> stay model
  RemoveAuthor -> removeAuthor model
  ClearAll ->
    (withEffects [ focusInput ] (clearState model)) { commit = Just emptyCondition }
  CloseSuggestions -> stay (closeSuggestions model)

  SuggestDue gen seq prefix
    | gen == model.gen && seq == model.suggest.seq -> case model.profile of
        Just profile -> withEffects [ Just <<< SuggestionsLoaded gen seq <$> suggestAuthors profile prefix ] model
        Nothing -> stay model
    | otherwise -> stay model
  SuggestionsLoaded gen seq result
    | gen == model.gen && seq == model.suggest.seq -> case result of
        Right items -> stay
          ( model
              { known = foldl (flip rememberAuthor) model.known items
              , suggest = model.suggest { items = items, loading = false, failed = false, active = Nothing, open = true }
              }
          )
        Left _ -> stay (model { suggest = model.suggest { items = [], loading = false, failed = true, active = Nothing, open = true } })
    | otherwise -> stay model

  ResolveDone gen seq thenSearch result
    | gen == model.gen && model.resolving == Just seq -> resolved thenSearch result (model { resolving = Nothing })
    | otherwise -> stay model

  Retry -> case model.results of
    SearchFailed _ -> withEffects [ fetchFirst model ] (model { results = Searching })
    _ -> stay model

  SearchLoaded gen result
    | gen == model.gen && model.results == Searching -> stay
        ( model
            { results = case result of
                Right page -> Found (dedupe [] page.notes) (tailOf page)
                Left error -> SearchFailed error
            }
        )
    | otherwise -> stay model

  SentinelSeen -> case model.results of
    Found _ (Next cursor) -> loadNext cursor model
    _ -> stay model
  LoadMore -> case model.results of
    Found _ (Next cursor) -> loadNext cursor model
    Found _ (Interrupted cursor) -> loadNext cursor model
    Found _ (NextFailed cursor _) -> loadNext cursor model
    _ -> stay model

  MoreLoaded gen cursor result
    | gen == model.gen -> case model.results of
        Found notes (LoadingNext waiting) | waiting == cursor -> stay
          ( model
              { results = case result of
                  Right page -> Found (dedupe notes page.notes) (tailOf page)
                  Left error -> Found notes (NextFailed cursor error)
              }
          )
        _ -> stay model
    | otherwise -> stay model

  NoSearchOp -> stay model

tailOf :: Page -> Tail
tailOf page = case page.nextCursor of
  Nothing -> End
  Just cursor | page.truncated -> Interrupted cursor
  Just cursor -> Next cursor

-- | Notes appended without any the list already has (the same Note twice is never shown twice).
dedupe :: Array Note -> Array Note -> Array Note
dedupe shown more = foldl add shown more
  where
  add acc note = if any (\other -> other.id == note.id) acc then acc else snoc acc note

loadNext :: String -> Model -> Step
loadNext cursor model = case model.results, model.profile of
  Found notes _, Just profile ->
    withEffects [ Just <<< MoreLoaded model.gen cursor <$> searchNotes profile model.condition (Just cursor) ]
      (model { results = Found notes (LoadingNext cursor) })
  _, _ -> stay model

-- | The text changed (not while an IME is composing): any resolve in flight is cancelled, an
-- | error of the old text goes, a space after `from:@acct` converts it, a `from:@` being typed
-- | asks for suggestions (after a short pause, so a burst of keys is one request).
typed :: String -> Model -> Step
typed text model = case spaceConversion parsed of
  Just acct -> resolve acct false typedModel
  Nothing -> case suggestionPrefix parsed of
    Just prefix ->
      let
        next = nextSeq typedModel
        seq = next.seq
      in
        withEffects [ delay (Milliseconds 180.0) $> Just (SuggestDue next.model.gen seq prefix) ]
          (next.model { suggest = next.model.suggest { open = true, loading = true, failed = false, seq = seq, active = Nothing } })
    Nothing -> stay (closeSuggestions typedModel)
  where
  parsed = parse text
  cancelled = nextSeq model
  typedModel = cancelled.model { input = text, resolving = Nothing, problem = Nothing }

-- | Hand-typed `from:@acct` is resolved by the server (ResolveNoteSearchAuthor); nothing else
-- | turns text into an author.
resolve :: String -> Boolean -> Model -> Step
resolve acct thenSearch model
  | acct == "" = stay (closeSuggestions model { problem = Just EmptyAcct })
  | isJust model.resolving = stay model
  | otherwise = case model.profile of
      Nothing -> stay model
      Just profile ->
        let
          next = nextSeq (closeSuggestions model)
        in
          withEffects [ Just <<< ResolveDone next.model.gen next.seq thenSearch <$> resolveAuthor profile acct ]
            (next.model { resolving = Just next.seq, problem = Nothing })

resolved :: Boolean -> Either ApiError Author -> Model -> Step
resolved thenSearch result model = case result of
  Right author ->
    let
      converted = becomeChip author model
    in
      if thenSearch then (withEffects [ focusInput ] converted) { commit = Just (conditionOf converted) }
      else withEffects [ focusInput ] converted
  Left error ->
    let
      typedAcct = case lastFrom (parse model.input) of
        Just acct -> acct
        Nothing -> ""
    in
      stay
        ( model
            { problem = Just
                ( case error of
                    SearchNotFound _ -> NotFound typedAcct
                    AuthorAmbiguous _ -> Ambiguous typedAcct
                    other -> LookupFailed other
                )
            }
        )

-- | The author becomes the chip (a second one replaces the first) and its `from:@…` text leaves the box.
becomeChip :: Author -> Model -> Model
becomeChip author model = (closeSuggestions model)
  { author = Just author
  , input = withoutFrom model.input
  , known = rememberAuthor author model.known
  , flash = model.flash + 1
  , problem = Nothing
  , resolving = Nothing
  }

-- | A suggestion is chosen: its own actor URL is the author (no resolve), and nothing is searched.
pick :: Author -> Model -> Step
pick author model = withEffects [ focusInput ] (becomeChip author model)

removeAuthor :: Model -> Step
removeAuthor model = withEffects [ focusInput ] (model { author = Nothing, problem = Nothing })
