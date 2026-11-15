-- | State of the post search screen (D04, host intents/shuttlepub/features/note-search-ui/ui-spec.md).
-- |
-- | The URL is the source of the confirmed condition (q and author actor URL, d04-q16); the
-- | model below holds the input box, the author chip, the suggestions and the results of the
-- | condition that is shown. Everything asynchronous carries `gen` (bumped whenever the
-- | condition, the Profile or the screen changes) and, for suggestions and resolves, a request
-- | sequence, so an answer that arrives late never overwrites newer input, another condition or
-- | another Profile.
module App.Search.Types where

import Prelude

import App.Api.Error (ApiError)
import Data.Argonaut.Decode.Class (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode.Class (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Either (Either)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Data.Show.Generic (genericShow)

-- | An author of the search (SearchAuthor of ShuttlePub #27). The avatar URL never reaches the
-- | browser (d09-q06). `acct` is "" and `displayName` Nothing for an author known only by the
-- | actor URL of a shared link: nothing more is made up from the URL.
type Author =
  { actorUrl :: String
  , acct :: String
  , displayName :: Maybe String
  }

-- | The confirmed condition (what the URL holds): the keyword and the author's actor URL.
type Condition =
  { q :: Maybe String
  , author :: Maybe String
  }

emptyCondition :: Condition
emptyCondition = { q: Nothing, author: Nothing }

data NoteKind = PostKind | ReplyKind | QuoteKind

derive instance Generic NoteKind _
derive instance Eq NoteKind

instance Show NoteKind where
  show = genericShow

instance EncodeJson NoteKind where
  encodeJson = genericEncodeJson

instance DecodeJson NoteKind where
  decodeJson = genericDecodeJson

-- | One searched Note as the contract gives it (SearchedNote of #23): no display name, avatar,
-- | counts or reactions. A content-warned Note has `text` Nothing: its body is not provided.
type Note =
  { id :: String
  , kind :: NoteKind
  , authorActorUrl :: String
  , createdAt :: String
  , text :: Maybe String
  , contentWarning :: Maybe String
  }

type Page =
  { notes :: Array Note
  , truncated :: Boolean
  , nextCursor :: Maybe String
  }

-- | What follows the notes shown. Only `Next` loads by itself (the scroll sentinel); an
-- | interrupted search (time limit, d04-q17) and a failed page wait for their button.
data Tail
  = End
  | Next String
  | Interrupted String
  | LoadingNext String
  | NextFailed String ApiError

derive instance Generic Tail _
derive instance Eq Tail

instance Show Tail where
  show = genericShow

instance EncodeJson Tail where
  encodeJson = genericEncodeJson

instance DecodeJson Tail where
  decodeJson = genericDecodeJson

data Results
  = Idle
  | Searching
  | Found (Array Note) Tail
  | SearchFailed ApiError

derive instance Generic Results _
derive instance Eq Results

instance Show Results where
  show = genericShow

instance EncodeJson Results where
  encodeJson = genericEncodeJson

instance DecodeJson Results where
  decodeJson = genericDecodeJson

-- | The author suggestion list under the box (combobox popup). `seq` identifies the request
-- | the list waits for; typing again or closing bumps it.
type Suggestions =
  { open :: Boolean
  , items :: Array Author
  , active :: Maybe Int
  , seq :: Int
  , failed :: Boolean
  , loading :: Boolean
  }

-- | Why the text of the box could not be turned into an author (shown as one short red line).
data Problem
  = NotFound String
  | Ambiguous String
  | EmptyAcct
  | LookupFailed ApiError

derive instance Generic Problem _
derive instance Eq Problem

instance Show Problem where
  show = genericShow

instance EncodeJson Problem where
  encodeJson = genericEncodeJson

instance DecodeJson Problem where
  decodeJson = genericDecodeJson

type Model =
  { gen :: Int
  , seqCounter :: Int
  -- | The Profile context id the state belongs to (Nothing until it is known).
  , profile :: Maybe String
  -- | Waiting for the Profile context before a condition of the URL can be searched.
  , waiting :: Boolean
  , input :: String
  , composing :: Boolean
  , author :: Maybe Author
  , condition :: Condition
  -- | Authors seen in this session (suggestions, resolves, the profile entry): the only source
  -- | of names for the chip and the result cards.
  , known :: Array Author
  , suggest :: Suggestions
  , resolving :: Maybe Int
  , problem :: Maybe Problem
  -- | Bumped when text becomes a chip (the chip is highlighted for a moment).
  , flash :: Int
  , results :: Results
  -- | Set once a search was interrupted (time limit): the rest of that search is loaded by the
  -- | button only (d04-q17) until a new condition is confirmed.
  , manual :: Boolean
  }

-- | The id of the search box (focus returns here; the combobox of ui-spec 2 検索欄).
searchInputId :: String
searchInputId = "sp-search-input"

emptySuggestions :: Suggestions
emptySuggestions = { open: false, items: [], active: Nothing, seq: 0, failed: false, loading: false }

init :: Model
init =
  { gen: 0
  , seqCounter: 0
  , profile: Nothing
  , waiting: false
  , input: ""
  , composing: false
  , author: Nothing
  , condition: emptyCondition
  , known: []
  , suggest: emptySuggestions
  , resolving: Nothing
  , problem: Nothing
  , flash: 0
  , results: Idle
  , manual: false
  }

-- | Everything the search screen can be told. Key actions come from App.Dom.keydownAction
-- | (the app's only keydown handler); answers carry the generation (and request) they answer.
data Message
  = InputChanged String
  | CompositionStarted
  | FieldClicked
  | CompositionEnded String
  | EnterPressed
  | MoveActive Int
  | BackspaceAtStart
  | CloseSuggestions
  | SuggestDue Int Int String
  | SuggestionsLoaded Int Int (Either ApiError (Array Author))
  | PickSuggestion Int
  | ResolveDone Int Int Boolean (Either ApiError Author)
  | RemoveAuthor
  | ClearAll
  | Retry
  | SearchLoaded Int (Either ApiError Page)
  | MoreLoaded Int String (Either ApiError Page)
  | SentinelSeen
  | LoadMore
  | NoSearchOp
