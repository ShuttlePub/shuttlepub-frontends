-- | GraphQL calls of the post search (D04). Typed against the PureScript types generated from
-- | bff/schema.graphql; errors keep their meaning (App.Api.Error) and are never turned into data.
module App.Search.Api
  ( searchNotes
  , suggestAuthors
  , resolveAuthor
  ) where

import Prelude

import App.Api.GraphQL (queryClient, run)
import App.Api.Error (ApiError)
import App.Search.Types (Author, Condition, NoteKind(..), Page)
import Data.Argonaut.Decode (decodeJson)
import Data.Either (Either)
import Data.Maybe (Maybe)
import Data.Newtype (unwrap)
import Effect.Aff (Aff)
import Generated.Schema.Gql.Enum.SearchedNoteKind (SearchedNoteKind(..)) as Gql
import GraphQL.Client.Args ((=>>))
import GraphQL.Client.ID (ID(..))
import GraphQL.Client.Query (queryFullRes)

type RawAuthor = { actorUrl :: String, acct :: String, displayName :: Maybe String }

authorSelection :: { actorUrl :: Unit, acct :: Unit, displayName :: Unit }
authorSelection = { actorUrl: unit, acct: unit, displayName: unit }

kindOf :: Gql.SearchedNoteKind -> NoteKind
kindOf = case _ of
  Gql.POST -> PostKind
  Gql.REPLY -> ReplyKind
  Gql.QUOTE -> QuoteKind

type RawNote =
  { noteId :: ID
  , kind :: Gql.SearchedNoteKind
  , authorActorUrl :: String
  , createdAt :: String
  , text :: Maybe String
  , contentWarning :: Maybe String
  }

type RawSearch =
  { searchNotes ::
      { notes :: Array RawNote
      , page :: { truncated :: Boolean, nextCursor :: Maybe String }
      }
  }

-- | One page of the search. The cursor (Nothing for the first page) is the one a previous
-- | page returned; it is never part of the URL.
searchNotes :: String -> Condition -> Maybe String -> Aff (Either ApiError Page)
searchNotes profile condition cursor = run convert $ queryFullRes decodeJson identity queryClient "SearchNotes"
  { searchNotes:
      { profile: ID profile, author: condition.author, q: condition.q, cursor } =>>
        { notes:
            { noteId: unit
            , kind: unit
            , authorActorUrl: unit
            , createdAt: unit
            , text: unit
            , contentWarning: unit
            }
        , page: { truncated: unit, nextCursor: unit }
        }
  }
  where
  convert :: RawSearch -> Page
  convert raw =
    { notes: map note raw.searchNotes.notes
    , truncated: raw.searchNotes.page.truncated
    , nextCursor: raw.searchNotes.page.nextCursor
    }
  note raw =
    { id: unwrap raw.noteId
    , kind: kindOf raw.kind
    , authorActorUrl: raw.authorActorUrl
    , createdAt: raw.createdAt
    , text: raw.text
    , contentWarning: raw.contentWarning
    }

suggestAuthors :: String -> String -> Aff (Either ApiError (Array Author))
suggestAuthors profile prefix = run (\(raw :: { suggestSearchAuthors :: Array RawAuthor }) -> raw.suggestSearchAuthors)
  $ queryFullRes decodeJson identity queryClient "SuggestSearchAuthors"
      { suggestSearchAuthors: { profile: ID profile, prefix } =>> authorSelection }

resolveAuthor :: String -> String -> Aff (Either ApiError Author)
resolveAuthor profile acct = run (\(raw :: { resolveSearchAuthor :: RawAuthor }) -> raw.resolveSearchAuthor)
  $ queryFullRes decodeJson identity queryClient "ResolveSearchAuthor"
      { resolveSearchAuthor: { profile: ID profile, acct } =>> authorSelection }
