module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
import Generated.Schema.Gql.Enum.ContentRestriction (ContentRestriction)
import Generated.Schema.Gql.Enum.DomainInputError (DomainInputError)
import Generated.Schema.Gql.Enum.EmojiImageState (EmojiImageState)
import Generated.Schema.Gql.Enum.EmojiKind (EmojiKind)
import Generated.Schema.Gql.Enum.EmojiUnavailableReason (EmojiUnavailableReason)
import Generated.Schema.Gql.Enum.EmojiUsage (EmojiUsage)
import Generated.Schema.Gql.Enum.HiddenCause (HiddenCause)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode)
import Generated.Schema.Gql.Enum.PostVisibility (PostVisibility)
import Generated.Schema.Gql.Enum.RelationActorKind (RelationActorKind)
import Generated.Schema.Gql.Enum.RelationActorStatus (RelationActorStatus)
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
  , checkDomainInput ::
      { input :: NotNull (AsGql "String" String) }
      ->
      -- | Normalizes a typed domain (URL, @user@host, path, port, case, trailing dot, IDN).
      AsGql "DomainInputCheck" DomainInputCheck
  , userPage ::
      { handle :: NotNull (AsGql "String" String), profile :: AsGql "ID" GraphQL.Client.ID.ID }
      ->
      -- | PROVISIONAL. A person's page; null when unknown.
      AsGql "UserPage" (Data.Maybe.Maybe (AsGql "UserPage" UserPage))
  , postView ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID), profile :: AsGql "ID" GraphQL.Client.ID.ID }
      ->
      -- | S8 GET .../notes/{noteId} (initially hidden for a controlled domain). Null when the post does not exist.
      AsGql "PostView" (Data.Maybe.Maybe (AsGql "PostView" PostView))
  , timeline ::
      { kind :: NotNull (AsGql "TimelineKind" TimelineKind)
      , profile :: AsGql "ID" GraphQL.Client.ID.ID
      }
      ->
      -- | PROVISIONAL. Newest first; items the Profile's controls suppress are left out without trace (S8).
      Array (AsGql "Post" Post)
  , replies ::
      { postId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , profile :: AsGql "ID" GraphQL.Client.ID.ID
      }
      ->
      -- | PROVISIONAL. Direct replies, oldest first, each as its S8 direct view.
      Array (AsGql "PostView" PostView)
  , domainControls ::
      { profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | Domain controls of the selected Profile, newest first. profile: see setDomainControl.
      Array (AsGql "DomainControl" DomainControl)
  , actorPolicies ::
      { profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | Individual mutes/blocks of the selected Profile, newest first.
      Array (AsGql "ActorPolicy" ActorPolicy)
  , actorBlockImpact ::
      { actorUrl :: NotNull (AsGql "String" String)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | Follows with exactly this actor that an individual block would detach (domain = the actor's host).
      AsGql "DomainBlockImpact" DomainBlockImpact
  , domainBlockImpact ::
      { domain :: NotNull (AsGql "String" String)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | Follows that a block of this exact domain would detach (pending and accepted).
      AsGql "DomainBlockImpact" DomainBlockImpact
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
  , revealUserPage ::
      { handle :: NotNull (AsGql "String" String), profile :: AsGql "ID" GraphQL.Client.ID.ID }
      ->
      -- | A person's page with each of their posts revealed on its own (S8 single-note reveal).
      AsGql "UserPage" (Data.Maybe.Maybe (AsGql "UserPage" UserPage))
  , revealPost ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID), profile :: AsGql "ID" GraphQL.Client.ID.ID }
      ->
      -- | S8 POST .../notes/{noteId}/reveal: this one post for the current page only. Null when it does not exist.
      AsGql "PostView" (Data.Maybe.Maybe (AsGql "PostView" PostView))
  , addActorPolicy ::
      { actorUrl :: NotNull (AsGql "String" String)
      , mode :: NotNull (AsGql "PolicyMode" PolicyMode)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      -> AsGql "ActorPolicy" ActorPolicy
  , removeDomainControl ::
      { domain :: NotNull (AsGql "String" String)
      , expectedRevision :: NotNull (AsGql "Int" Int)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      -> AsGql "PolicyRemoval" PolicyRemoval
  , setDomainControl ::
      { domain :: NotNull (AsGql "String" String)
      , expectedRevision :: AsGql "Int" Int
      , mode :: NotNull (AsGql "PolicyMode" PolicyMode)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | Create (expectedRevision omitted) or replace (expectedRevision = current revision) a domain
      -- | control of the selected Profile. profile is the Profile context id the client is showing;
      -- | a different selection fails with PROFILE_CHANGED. Conflicts fail with REVISION_CONFLICT.
      AsGql "DomainControl" DomainControl
  , removeActorPolicy ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , mode :: NotNull (AsGql "PolicyMode" PolicyMode)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      -> AsGql "PolicyRemoval" PolicyRemoval
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
-- | A Profile's domain control as S8 reports it on content: mode, the exact domain and the E8 revision. Nothing else about the item.
newtype ContentControl = ContentControl
  { domain :: {} -> AsGql "String" String
  , mode :: {} -> AsGql "PolicyMode" PolicyMode
  , revision :: {} -> AsGql "Int" Int
  }

derive instance Data.Newtype.Newtype ContentControl _
-- | A removed setting: the domain or the actor policy id.
newtype PolicyRemoval = PolicyRemoval { key :: {} -> AsGql "String" String }

derive instance Data.Newtype.Newtype PolicyRemoval _
-- | An owned Emumet integrated Account/Profile. id is its public Account nanoid; the current API does not expose an internal Profile id.
newtype Profile = Profile
  { displayName :: {} -> AsGql "String" String
  , handle :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Profile _
-- | Display information of the target of an individual mute/block (Emumet ProfileRelationActor),
-- | served from the Profile (local) or a server-side cache; the list never contacts a remote server.
-- | Absent fields are null and never derived from actorUrl: a PENDING (fetch started) or UNAVAILABLE
-- | target has no name/icon/acct and the UI falls back to actorUrl.
newtype RelationActor = RelationActor
  { displayName :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , kind :: {} -> AsGql "RelationActorKind" RelationActorKind
  , preferredUsername :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , status :: {} -> AsGql "RelationActorStatus" RelationActorStatus
  , iconUrl ::
      {}
      ->
      -- | Absolute http(s) URL of the avatar as stored. For a remote actor it points at another server,
      -- | which the browser must not load directly (d09-q06: no ShuttlePub-side delivery route exists, so a
      -- | placeholder icon is shown); how the screen uses it is decided by the D08 display unit.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , actorUrl ::
      {}
      ->
      -- | Canonical actor URL; always equal to the policy's actorUrl.
      AsGql "String" String
  , profileId ::
      {}
      ->
      -- | Profile nanoid; set only when kind is LOCAL.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , acct ::
      {}
      ->
      -- | preferred_username@host without a leading @.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  }

derive instance Data.Newtype.Newtype RelationActor _
-- | Exact-match domain control of the selected Profile (Emumet domain-controls). domain is
-- | Emumet's normalized form; example.com does not cover sub.example.com.
newtype DomainControl = DomainControl
  { createdAt :: {} -> AsGql "String" String
  , domain :: {} -> AsGql "String" String
  , mode :: {} -> AsGql "PolicyMode" PolicyMode
  , revision ::
      {}
      ->
      -- | Send back as expectedRevision to replace or remove exactly this state.
      AsGql "Int" Int
  }

derive instance Data.Newtype.Newtype DomainControl _
-- | Existing follows of the selected Profile with actors on exactly this domain (canonical actor URLs).
newtype DomainBlockImpact = DomainBlockImpact
  { domain :: {} -> AsGql "String" String
  , followers :: {} -> Array (AsGql "String" String)
  , following :: {} -> Array (AsGql "String" String)
  }

derive instance Data.Newtype.Newtype DomainBlockImpact _
-- | Individual mute/block of the selected Profile (list and create answers alike carry targetActor).
newtype ActorPolicy = ActorPolicy
  { actorUrl :: {} -> AsGql "String" String
  , createdAt :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , mode :: {} -> AsGql "PolicyMode" PolicyMode
  , targetActor :: {} -> AsGql "RelationActor" RelationActor
  }

derive instance Data.Newtype.Newtype ActorPolicy _
-- | Maps EmojiView. value is the Unicode sequence (UNICODE) or the stable custom emoji id (CUSTOM).
newtype Emoji = Emoji
  { available :: {} -> AsGql "Boolean" Boolean
  , kind :: {} -> AsGql "EmojiKind" EmojiKind
  , unavailableReason ::
      {}
      -> AsGql "EmojiUnavailableReason"
           (Data.Maybe.Maybe (AsGql "EmojiUnavailableReason" EmojiUnavailableReason))
  , value :: {} -> AsGql "String" String
  , imageState ::
      {}
      ->
      -- | Custom emoji only (null for Unicode). MISSING means show :shortcode:; PRESENT goes with imageUrl for this server's emoji (an external emoji is shown as :shortcode: either way).
      AsGql "EmojiImageState" (Data.Maybe.Maybe (AsGql "EmojiImageState" EmojiImageState))
  , shortcode ::
      {}
      ->
      -- | Custom emoji only, without colons.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , usage ::
      {}
      ->
      -- | Custom emoji only; null means ANYWHERE (Unicode). An external emoji is EXISTING_REACTION_ONLY.
      AsGql "EmojiUsage" (Data.Maybe.Maybe (AsGql "EmojiUsage" EmojiUsage))
  , imageUrl ::
      {}
      ->
      -- | Image of this server's own custom emoji only, absent once deleted. Always null for an external
      -- | emoji (origin set): its image lives on another server and the browser never loads it directly
      -- | (d09-q06; the contract has no ShuttlePub-side delivery route), so the UI shows :shortcode: with
      -- | the external mark.
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , origin ::
      {}
      ->
      -- | Originating domain of an external custom emoji; null for Unicode and this server's own emoji, so a value is the external mark.
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
-- | One post seen directly (S8 DirectNoteResponse), by its provisional id. Exactly one of post /
-- | hidden / restriction is set. hidden carries only the cause and the control (no text, author
-- | or quote). operations accompany a visible or restricted post; a reveal never clears a block.
-- | reactionCounts accompany a visible post.
newtype PostView = PostView
  { hidden :: {} -> AsGql "HiddenContent" (Data.Maybe.Maybe (AsGql "HiddenContent" HiddenContent))
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , operations ::
      {} -> AsGql "PostOperations" (Data.Maybe.Maybe (AsGql "PostOperations" PostOperations))
  , post :: {} -> AsGql "Post" (Data.Maybe.Maybe (AsGql "Post" Post))
  , reactionCounts ::
      {} -> AsGql "ReactionCounts" (Data.Maybe.Maybe (AsGql "ReactionCounts" ReactionCounts))
  , restriction ::
      {}
      -> AsGql "ContentRestriction" (Data.Maybe.Maybe (AsGql "ContentRestriction" ContentRestriction))
  }

derive instance Data.Newtype.Newtype PostView _
-- | PROVISIONAL. A person's page (ui-spec 3-6): the person is always shown, their posts are hidden while control is set.
newtype UserPage = UserPage
  { author :: {} -> AsGql "PostAuthor" PostAuthor
  , bio :: {} -> AsGql "String" String
  , posts :: {} -> Array (AsGql "PostView" PostView)
  , hidden ::
      {}
      ->
      -- | Set while the posts are hidden (posts is then empty).
      AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  , control ::
      {}
      ->
      -- | The Profile's control on the person's domain (the badge).
      AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  }

derive instance Data.Newtype.Newtype UserPage _
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
  , quoted ::
      {}
      ->
      -- | Set for a quote: its target (S8 EmbeddedNotePresentation).
      AsGql "QuotedPost" (Data.Maybe.Maybe (AsGql "QuotedPost" QuotedPost))
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
  , actorUrl ::
      {}
      ->
      -- | Canonical actor URL: what an individual mute/block of this person names.
      AsGql "String" String
  , domain ::
      {}
      ->
      -- | Host of actorUrl: the only domain whose mute/block applies to this person (S8 exact match).
      AsGql "String" String
  , local ::
      {}
      ->
      -- | On this server: its domain cannot be muted or blocked.
      AsGql "Boolean" Boolean
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
-- | Result of normalizing what the viewer typed: exactly one of domain / error is set.
newtype DomainInputCheck = DomainInputCheck
  { domain :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , error ::
      {} -> AsGql "DomainInputError" (Data.Maybe.Maybe (AsGql "DomainInputError" DomainInputError))
  }

derive instance Data.Newtype.Newtype DomainInputCheck _
-- | S8 EmbeddedNotePresentation of a revealed quote's target: exactly one of post / restriction.
-- | There is no hidden variant: a controlled target hides the whole quote (HiddenContent QUOTE).
newtype QuotedPost = QuotedPost
  { post :: {} -> AsGql "Post" (Data.Maybe.Maybe (AsGql "Post" Post))
  , restriction ::
      {}
      -> AsGql "ContentRestriction" (Data.Maybe.Maybe (AsGql "ContentRestriction" ContentRestriction))
  }

derive instance Data.Newtype.Newtype QuotedPost _
-- | S8 EmojiReactionCount: a chip of the note's reactions. emoji carries the chip's view data (origin, image state, usage).
newtype ReactionChip = ReactionChip
  { count :: {} -> AsGql "Int" Int, emoji :: {} -> AsGql "Emoji" Emoji }

derive instance Data.Newtype.Newtype ReactionChip _
-- | S8 NotePresentation hidden: the cause and the control that caused it. Only a hidden note carries a cause (ContentControl elsewhere has none).
newtype HiddenContent = HiddenContent
  { cause :: {} -> AsGql "HiddenCause" HiddenCause
  , control :: {} -> AsGql "ContentControl" ContentControl
  }

derive instance Data.Newtype.Newtype HiddenContent _
-- | S8 PostOperationAvailability (domain part only): null = not refused by a domain block; set = the block that refuses it.
newtype PostOperations = PostOperations
  { emojiReaction ::
      {} -> AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  , like :: {} -> AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  , quote :: {} -> AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  , reply :: {} -> AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  , repost ::
      {} -> AsGql "ContentControl" (Data.Maybe.Maybe (AsGql "ContentControl" ContentControl))
  }

derive instance Data.Newtype.Newtype PostOperations _
-- | S8 ReactionCounts of a visible note: accepted historical counts (not reduced by a block).
newtype ReactionCounts = ReactionCounts
  { emoji :: {} -> Array (AsGql "ReactionChip" ReactionChip), likes :: {} -> AsGql "Int" Int }

derive instance Data.Newtype.Newtype ReactionCounts _
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
