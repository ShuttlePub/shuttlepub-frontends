module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
import Generated.Schema.Gql.Enum.EmojiKind (EmojiKind)
import Generated.Schema.Gql.Enum.EmojiUnavailableReason (EmojiUnavailableReason)
import Generated.Schema.Gql.Enum.PostVisibility (PostVisibility)
import Generated.Schema.Gql.Enum.TimelineKind (TimelineKind)
import GraphQL.Client.Args (NotNull)
import GraphQL.Client.AsGql (AsGql)
import GraphQL.Client.ID as GraphQL.Client.ID
import GraphQL.Client.Union as GraphQL.Client.Union
import Type.Proxy as Type.Proxy

type Schema =
  { directives :: Type.Proxy.Proxy Directives
  , query :: Query
  , mutation :: Mutation
  , subscription :: Data.Void.Void
  }

type Id =
  -- | The `ID` scalar type represents a unique identifier, often used to refetch an object or as key for a cache. The ID type appears in a JSON response as a String; however, it is not intended to be human-readable. When expected as an input type, any string (such as `"4"`) or integer (such as `4`) input value will be accepted as an ID.
  GraphQL.Client.ID.ID

newtype Query = Query
  { apiMode :: {} -> AsGql "ApiMode" ApiMode
  , apiStatus :: {} -> AsGql "ApiStatus" ApiStatus
  , availableProfiles :: {} -> Array (AsGql "Profile" Profile)
  , profileContext :: {} -> AsGql "ProfileContext" ProfileContext
  , customEmojis ::
      {}
      ->
      -- | PROVISIONAL. The server's custom emoji (available or not).
      Array (AsGql "Emoji" Emoji)
  , post ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | PROVISIONAL. Null when the post does not exist.
      AsGql "Post" (Data.Maybe.Maybe (AsGql "Post" Post))
  , timeline ::
      { kind :: NotNull (AsGql "TimelineKind" TimelineKind) }
      ->
      -- | PROVISIONAL. Newest first.
      Array (AsGql "Post" Post)
  , replies ::
      { postId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | PROVISIONAL. Direct replies, oldest first.
      Array (AsGql "Post" Post)
  , quickReactionSettings ::
      { profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | GET .../quick-reaction-settings.
      AsGql "QuickReactionSettings" QuickReactionSettings
  , postReactions ::
      { noteIds :: NotNull (Array (NotNull (AsGql "ID" GraphQL.Client.ID.ID)))
      , profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | Reactions on each Note (at most 100), in the order asked.
      Array (AsGql "PostReactions" PostReactions)
  }

derive instance Data.Newtype.Newtype Query _
newtype Mutation = Mutation
  { selectProfile ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | Select an identity from the current viewer's owned Emumet accounts (integrated Profile API).
      AsGql "ProfileContext" ProfileContext
  , createPost ::
      { input :: NotNull (AsGql "CreatePostInput" CreatePostInput) }
      ->
      -- | PROVISIONAL. Always NOT_IMPLEMENTED (both modes) until the backend publishes a contract.
      AsGql "Post" Post
  , updateQuickReactionSettings ::
      { expectedRevision :: NotNull (AsGql "Int" Int)
      , favorites :: NotNull (Array (NotNull (AsGql "EmojiInput" EmojiInput)))
      , profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | PUT .../quick-reaction-settings (full replacement guarded by expectedRevision).
      AsGql "QuickReactionSettings" QuickReactionSettings
  , removeNoteReaction ::
      { noteId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | DELETE .../notes/{noteId}/reaction (succeeds also for an unavailable emoji).
      AsGql "NoteReaction" NoteReaction
  , setNoteReaction ::
      { emoji :: NotNull (AsGql "EmojiInput" EmojiInput)
      , noteId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | PUT .../notes/{noteId}/reaction.
      AsGql "NoteReaction" NoteReaction
  }

derive instance Data.Newtype.Newtype Mutation _
-- | An owned Emumet integrated Account/Profile. id is its public Account nanoid; the current API does not expose an internal Profile id.
newtype Profile = Profile
  { displayName :: {} -> AsGql "String" String
  , handle :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Profile _
-- | Maps EmojiView. value is the Unicode sequence (UNICODE) or the stable custom emoji id (CUSTOM).
newtype Emoji = Emoji
  { available :: {} -> AsGql "Boolean" Boolean
  , kind :: {} -> AsGql "EmojiKind" EmojiKind
  , unavailableReason ::
      {}
      -> AsGql "EmojiUnavailableReason"
           (Data.Maybe.Maybe (AsGql "EmojiUnavailableReason" EmojiUnavailableReason))
  , value :: {} -> AsGql "String" String
  , imageUrl ::
      {}
      ->
      -- | Custom emoji only, absent once deleted.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , shortcode ::
      {}
      ->
      -- | Custom emoji only, without colons.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  }

derive instance Data.Newtype.Newtype Emoji _
-- | Maps GET /api/v1/status (operation getApiStatus).
newtype ApiStatus = ApiStatus { apiVersion :: {} -> AsGql "String" String }

derive instance Data.Newtype.Newtype ApiStatus _
-- | Maps QuickReactionSettings of one Profile. revision 0 = never saved.
newtype QuickReactionSettings = QuickReactionSettings
  { favorites :: {} -> Array (AsGql "Emoji" Emoji)
  , profileId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , revision :: {} -> AsGql "Int" Int
  }

derive instance Data.Newtype.Newtype QuickReactionSettings _
-- | Maps ReactionState: the acting Profile's reaction on a Note (null = not reacted).
newtype NoteReaction = NoteReaction
  { emoji :: {} -> AsGql "Emoji" (Data.Maybe.Maybe (AsGql "Emoji" Emoji))
  , noteId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , profileId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype NoteReaction _
-- | PROVISIONAL. A post as shown on a timeline or the post detail screen.
newtype Post = Post
  { author :: {} -> AsGql "PostAuthor" PostAuthor
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , inReplyToId :: {} -> AsGql "ID" (Data.Maybe.Maybe (AsGql "ID" GraphQL.Client.ID.ID))
  , replyCount :: {} -> AsGql "Int" Int
  , repostCount :: {} -> AsGql "Int" Int
  , text :: {} -> AsGql "String" String
  , createdAt ::
      {}
      ->
      -- | ISO 8601 instant.
      AsGql "String" String
  , repostedBy ::
      {}
      ->
      -- | Set when this timeline entry is someone's repost.
      AsGql "PostAuthor" (Data.Maybe.Maybe (AsGql "PostAuthor" PostAuthor))
  , noteId ::
      {}
      ->
      -- | The ShuttlePub Note id (UUID) behind the post: the noteId of the quick reaction operations.
      AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Post _
-- | PROVISIONAL. One emoji's reactions by other people (the acting Profile's own excluded).
newtype ReactionGroup = ReactionGroup
  { count :: {} -> AsGql "Int" Int
  , emoji :: {} -> AsGql "Emoji" Emoji
  , reactors :: {} -> Array (AsGql "Reactor" Reactor)
  }

derive instance Data.Newtype.Newtype ReactionGroup _
-- | PROVISIONAL. Someone who reacted. handle is user@host without the leading @.
newtype Reactor = Reactor
  { displayName :: {} -> AsGql "String" String
  , handle :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Reactor _
-- | PROVISIONAL. The author of a post. handle is user@host without the leading @.
newtype PostAuthor = PostAuthor
  { displayName :: {} -> AsGql "String" String
  , handle :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype PostAuthor _
-- | Reactions on a Note seen by one Profile: mine (S3) and other people's (PROVISIONAL).
newtype PostReactions = PostReactions
  { mine :: {} -> AsGql "Emoji" (Data.Maybe.Maybe (AsGql "Emoji" Emoji))
  , noteId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , others :: {} -> Array (AsGql "ReactionGroup" ReactionGroup)
  , profileId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype PostReactions _
-- | The Profile the viewer is currently acting as. Null when there is none.
newtype ProfileContext = ProfileContext
  { activeProfile :: {} -> AsGql "Profile" (Data.Maybe.Maybe (AsGql "Profile" Profile)) }

derive instance Data.Newtype.Newtype ProfileContext _
-- | Maps EmojiRef.
newtype EmojiInput = EmojiInput
  { kind :: NotNull (AsGql "EmojiKind" EmojiKind), value :: NotNull (AsGql "String" String) }

derive instance Data.Newtype.Newtype EmojiInput _
-- | PROVISIONAL. Input of the compose form.
newtype CreatePostInput = CreatePostInput
  { text :: NotNull (AsGql "String" String)
  , visibility :: NotNull (AsGql "PostVisibility" PostVisibility)
  }

derive instance Data.Newtype.Newtype CreatePostInput _
