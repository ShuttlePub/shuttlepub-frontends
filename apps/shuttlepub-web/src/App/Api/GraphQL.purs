module App.Api.GraphQL
  ( fetchApiMode
  , fetchApiStatus
  , fetchProfileContext
  , fetchAvailableProfiles
  , fetchTimeline
  , fetchPostDetail
  , revealPost
  , fetchUserPage
  , revealUserPage
  , selectProfile
  , createPost
  , fetchQuickSettings
  , saveQuickSettings
  , fetchPostReactions
  , fetchCustomEmojis
  , setNoteReaction
  , removeNoteReaction
  ) where

import Prelude

import App.Api.Error (ApiError(..), fromGqlCode, withReason)
import App.Emoji (Emoji, EmojiImageState(..), EmojiKind(..), EmojiUsage(..), UnavailableReason(..))
import App.Model (ApiStatus, PostDetailData)
import App.Post (Author, Control, Operations, Post, PostView, Quoted(..), TimelineTab(..), UserPage, Visibility(..))
import App.Profile (Profile, ProfileContext)
import App.Reaction (PostReactions, QuickSettings)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, printJsonDecodeError)
import Data.Array (head)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Effect.Aff (Aff, message, try)
import Foreign.Object as FO
import Generated.Schema.Gql (Mutation, Query)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
import Generated.Schema.Gql.Enum.ContentRestriction (ContentRestriction)
import Generated.Schema.Gql.Enum.EmojiImageState as GqlImageState
import Generated.Schema.Gql.Enum.EmojiKind as GqlEmojiKind
import Generated.Schema.Gql.Enum.EmojiUnavailableReason as GqlReason
import Generated.Schema.Gql.Enum.EmojiUsage as GqlUsage
import Generated.Schema.Gql.Enum.HiddenCause (HiddenCause)
import Generated.Schema.Gql.Enum.PostVisibility as GqlVisibility
import Generated.Schema.Gql.Enum.TimelineKind as GqlTimeline
import GraphQL.Client.Args (Args(..))
import GraphQL.Client.BaseClients.Affjax.Web (AffjaxWebClient(..))
import GraphQL.Client.GqlError (GqlError)
import GraphQL.Client.ID (ID(..))
import GraphQL.Client.Query (getFullRes, mutationJson, queryFullRes)
import GraphQL.Client.Types (Client(..), GqlRes, GqlResJson(..))
import Type.Data.List (Nil')
import Type.Proxy (Proxy)

-- | Typed against the PureScript types generated from bff/schema.graphql
-- | (src/Generated, never hand-edited): a query naming a field that is not in
-- | the SDL does not compile.
queryClient :: Client AffjaxWebClient { directives :: Proxy Nil', query :: Query | () }
queryClient = Client (AffjaxWebClient "/graphql" [])

mutationClient :: Client AffjaxWebClient { directives :: Proxy Nil', mutation :: Mutation | () }
mutationClient = Client (AffjaxWebClient "/graphql" [])

-- | GraphQL errors win over data: a failed backend call must surface as an
-- | error, never as a partially decoded value.
gqlResToEither :: forall a. GqlRes a -> Either ApiError a
gqlResToEither { data_, errors } = case errors of
  Just errs | Just first <- head errs -> Left (errorFromGql first)
  Just _ -> Left (Unexpected "GraphQL response carried an empty error list")
  Nothing -> case data_ of
    Left decodeError -> Left (InvalidResponse (printJsonDecodeError decodeError))
    Right value -> Right value

errorFromGql :: GqlError -> ApiError
errorFromGql { message: text, extensions } =
  withReason (extensions >>= extension "reason") (fromGqlCode (extensions >>= extension "code") text)
  where
  extension key exts = FO.lookup key exts >>= \json -> case decodeJson json of
    Right value -> Just value
    Left _ -> Nothing

-- | Runs a request and maps transport failures to NetworkError.
run :: forall a b. (a -> b) -> Aff (GqlRes a) -> Aff (Either ApiError b)
run convert request = do
  result <- try request
  pure $ case result of
    Left affError -> Left (NetworkError (message affError))
    Right gqlRes -> map convert (gqlResToEither gqlRes)

-- | mutationFullRes of graphql-client 10.1.1 demands a `query` client, so mutations go
-- | through mutationJson; the phantom `res` keeps the decoded type tied to the query.
fullRes :: forall schema query res. DecodeJson res => GqlResJson schema query res -> GqlRes res
fullRes (GqlResJson json) = getFullRes decodeJson json

fetchApiMode :: Aff (Either ApiError ApiMode)
fetchApiMode = run _.apiMode $ queryFullRes decodeJson identity queryClient "ApiMode"
  { apiMode: unit }

fetchApiStatus :: Aff (Either ApiError ApiStatus)
fetchApiStatus = run _.apiStatus $ queryFullRes decodeJson identity queryClient "ApiStatus"
  { apiStatus: { apiVersion: unit } }

profileSelection :: { id :: Unit, handle :: Unit, displayName :: Unit }
profileSelection = { id: unit, handle: unit, displayName: unit }

unwrapProfile :: { id :: ID, handle :: String, displayName :: String } -> Profile
unwrapProfile p = { id: unwrap p.id, handle: p.handle, displayName: p.displayName }

fetchProfileContext :: Aff (Either ApiError ProfileContext)
fetchProfileContext =
  run (\raw -> { activeProfile: map unwrapProfile raw.profileContext.activeProfile })
    $ queryFullRes decodeJson identity queryClient "ProfileContext"
        { profileContext: { activeProfile: profileSelection } }

fetchAvailableProfiles :: Aff (Either ApiError (Array Profile))
fetchAvailableProfiles =
  run (\raw -> map unwrapProfile raw.availableProfiles)
    $ queryFullRes decodeJson identity queryClient "AvailableProfiles"
        { availableProfiles: profileSelection }

selectProfile :: String -> Aff (Either ApiError ProfileContext)
selectProfile profileId =
  run (\raw -> { activeProfile: map unwrapProfile raw.selectProfile.activeProfile })
    $ fullRes <$> mutationJson identity mutationClient "SelectProfile"
        { selectProfile: { id: ID profileId } `Args` { activeProfile: profileSelection } }

-- Posts. profile is the Profile context id the page shows (Nothing when there is none,
-- e.g. signed out: real mode answers NOT_IMPLEMENTED before it matters). What the BFF
-- returns follows the S8 contract: a hidden post carries only its control.

type AuthorSelection = { id :: Unit, handle :: Unit, displayName :: Unit, actorUrl :: Unit, domain :: Unit, local :: Unit }

authorSelection :: AuthorSelection
authorSelection = { id: unit, handle: unit, displayName: unit, actorUrl: unit, domain: unit, local: unit }

type ControlSelection = { mode :: Unit, domain :: Unit, revision :: Unit }

controlSelection :: ControlSelection
controlSelection = { mode: unit, domain: unit, revision: unit }

type InnerPostSelection =
  { id :: Unit
  , noteId :: Unit
  , author :: AuthorSelection
  , text :: Unit
  , createdAt :: Unit
  , replyCount :: Unit
  , repostCount :: Unit
  , repostedBy :: AuthorSelection
  , inReplyToId :: Unit
  }

innerPostSelection :: InnerPostSelection
innerPostSelection =
  { id: unit
  , noteId: unit
  , author: authorSelection
  , text: unit
  , createdAt: unit
  , replyCount: unit
  , repostCount: unit
  , repostedBy: authorSelection
  , inReplyToId: unit
  }

type PostSelection =
  { id :: Unit
  , noteId :: Unit
  , author :: AuthorSelection
  , text :: Unit
  , createdAt :: Unit
  , replyCount :: Unit
  , repostCount :: Unit
  , repostedBy :: AuthorSelection
  , inReplyToId :: Unit
  , quoted :: { post :: InnerPostSelection, restriction :: Unit }
  }

-- | One level of quote: the quoted post's own quote is not asked for.
postSelection :: PostSelection
postSelection =
  { id: unit
  , noteId: unit
  , author: authorSelection
  , text: unit
  , createdAt: unit
  , replyCount: unit
  , repostCount: unit
  , repostedBy: authorSelection
  , inReplyToId: unit
  , quoted: { post: innerPostSelection, restriction: unit }
  }

type HiddenSelection = { cause :: Unit, control :: ControlSelection }

hiddenSelection :: HiddenSelection
hiddenSelection = { cause: unit, control: controlSelection }

type ReactionCountsSelection = { likes :: Unit, emoji :: { emoji :: EmojiSelection, count :: Unit } }

reactionCountsSelection :: ReactionCountsSelection
reactionCountsSelection = { likes: unit, emoji: { emoji: emojiSelection, count: unit } }

type ViewSelection =
  { id :: Unit
  , post :: PostSelection
  , hidden :: HiddenSelection
  , restriction :: Unit
  , operations ::
      { reply :: ControlSelection
      , quote :: ControlSelection
      , repost :: ControlSelection
      , like :: ControlSelection
      , emojiReaction :: ControlSelection
      }
  , reactionCounts :: ReactionCountsSelection
  }

viewSelection :: ViewSelection
viewSelection =
  { id: unit
  , post: postSelection
  , hidden: hiddenSelection
  , restriction: unit
  , operations: { reply: controlSelection, quote: controlSelection, repost: controlSelection, like: controlSelection, emojiReaction: controlSelection }
  , reactionCounts: reactionCountsSelection
  }

type UserPageSelection =
  { author :: AuthorSelection, bio :: Unit, control :: ControlSelection, hidden :: ControlSelection, posts :: ViewSelection }

userPageSelection :: UserPageSelection
userPageSelection = { author: authorSelection, bio: unit, control: controlSelection, hidden: controlSelection, posts: viewSelection }

type RawAuthor = { id :: ID, handle :: String, displayName :: String, actorUrl :: String, domain :: String, local :: Boolean }

type RawInnerPost =
  { id :: ID
  , noteId :: ID
  , author :: RawAuthor
  , text :: String
  , createdAt :: String
  , replyCount :: Int
  , repostCount :: Int
  , repostedBy :: Maybe RawAuthor
  , inReplyToId :: Maybe ID
  }

type RawPost =
  { id :: ID
  , noteId :: ID
  , author :: RawAuthor
  , text :: String
  , createdAt :: String
  , replyCount :: Int
  , repostCount :: Int
  , repostedBy :: Maybe RawAuthor
  , inReplyToId :: Maybe ID
  , quoted :: Maybe { post :: Maybe RawInnerPost, restriction :: Maybe ContentRestriction }
  }

type RawView =
  { id :: ID
  , post :: Maybe RawPost
  , hidden :: Maybe { cause :: HiddenCause, control :: Control }
  , restriction :: Maybe ContentRestriction
  , operations :: Maybe Operations
  , reactionCounts :: Maybe { likes :: Int, emoji :: Array { emoji :: RawEmoji, count :: Int } }
  }

type RawUserPage = { author :: RawAuthor, bio :: String, control :: Maybe Control, hidden :: Maybe Control, posts :: Array RawView }

toAuthor :: RawAuthor -> Author
toAuthor a = { id: unwrap a.id, handle: a.handle, displayName: a.displayName, actorUrl: a.actorUrl, domain: a.domain, local: a.local }

toInnerPost :: RawInnerPost -> Post
toInnerPost p =
  { id: unwrap p.id
  , noteId: unwrap p.noteId
  , author: toAuthor p.author
  , text: p.text
  , createdAt: p.createdAt
  , replyCount: p.replyCount
  , repostCount: p.repostCount
  , repostedBy: map toAuthor p.repostedBy
  , inReplyToId: map unwrap p.inReplyToId
  , quoted: Nothing
  }

toPost :: RawPost -> Post
toPost p =
  { id: unwrap p.id
  , noteId: unwrap p.noteId
  , author: toAuthor p.author
  , text: p.text
  , createdAt: p.createdAt
  , replyCount: p.replyCount
  , repostCount: p.repostCount
  , repostedBy: map toAuthor p.repostedBy
  , inReplyToId: map unwrap p.inReplyToId
  , quoted: p.quoted <#> \q -> Quoted { post: map toInnerPost q.post, restriction: q.restriction }
  }

toView :: RawView -> PostView
toView v =
  { id: unwrap v.id
  , post: map toPost v.post
  , hidden: v.hidden
  , restriction: v.restriction
  , operations: v.operations
  , reactionCounts: v.reactionCounts <#> \counts ->
      { likes: counts.likes, emoji: counts.emoji <#> \chip -> { emoji: toEmoji chip.emoji, count: chip.count } }
  }

toUserPage :: RawUserPage -> UserPage
toUserPage p = { author: toAuthor p.author, bio: p.bio, control: p.control, hidden: p.hidden, posts: map toView p.posts }

timelineKind :: TimelineTab -> GqlTimeline.TimelineKind
timelineKind = case _ of
  HomeTimeline -> GqlTimeline.HOME
  LocalTimeline -> GqlTimeline.LOCAL
  FederatedTimeline -> GqlTimeline.FEDERATED

fetchTimeline :: Maybe String -> TimelineTab -> Aff (Either ApiError (Array Post))
fetchTimeline profile tab = run (\(raw :: { timeline :: Array RawPost }) -> map toPost raw.timeline) case profile of
  Just id -> queryFullRes decodeJson identity queryClient "Timeline"
    { timeline: { profile: ID id, kind: timelineKind tab } `Args` postSelection }
  Nothing -> queryFullRes decodeJson identity queryClient "TimelineWithoutProfile"
    { timeline: { kind: timelineKind tab } `Args` postSelection }

-- | The post (S8 direct view, not revealed) and its direct replies, each as a direct
-- | view; either both or an error.
fetchPostDetail :: Maybe String -> String -> Aff (Either ApiError PostDetailData)
fetchPostDetail profile postId = run convert case profile of
  Just id -> queryFullRes decodeJson identity queryClient "PostDetail"
    { postView: { profile: ID id, id: ID postId } `Args` viewSelection
    , replies: { profile: ID id, postId: ID postId } `Args` viewSelection
    }
  Nothing -> queryFullRes decodeJson identity queryClient "PostDetailWithoutProfile"
    { postView: { id: ID postId } `Args` viewSelection
    , replies: { postId: ID postId } `Args` viewSelection
    }
  where
  convert :: { postView :: Maybe RawView, replies :: Array RawView } -> PostDetailData
  convert raw = { view: map toView raw.postView, replies: map toView raw.replies }

-- | S8 single-note reveal: this post, for the current page only (Nothing: it is gone).
revealPost :: String -> String -> Aff (Either ApiError (Maybe PostView))
revealPost profile postId =
  run (\(raw :: { revealPost :: Maybe RawView }) -> map toView raw.revealPost)
    $ fullRes <$> mutationJson identity mutationClient "RevealPost"
        { revealPost: { profile: ID profile, id: ID postId } `Args` viewSelection }

fetchUserPage :: Maybe String -> String -> Aff (Either ApiError (Maybe UserPage))
fetchUserPage profile handle = run (\(raw :: { userPage :: Maybe RawUserPage }) -> map toUserPage raw.userPage) case profile of
  Just id -> queryFullRes decodeJson identity queryClient "UserPage"
    { userPage: { profile: ID id, handle } `Args` userPageSelection }
  Nothing -> queryFullRes decodeJson identity queryClient "UserPageWithoutProfile"
    { userPage: { handle } `Args` userPageSelection }

-- | The page with each of the person's posts revealed on its own (S8 single-note reveal).
revealUserPage :: String -> String -> Aff (Either ApiError (Maybe UserPage))
revealUserPage profile handle =
  run (\(raw :: { revealUserPage :: Maybe RawUserPage }) -> map toUserPage raw.revealUserPage)
    $ fullRes <$> mutationJson identity mutationClient "RevealUserPage"
        { revealUserPage: { profile: ID profile, handle } `Args` userPageSelection }

postVisibility :: Visibility -> GqlVisibility.PostVisibility
postVisibility = case _ of
  Public -> GqlVisibility.PUBLIC
  HomeOnly -> GqlVisibility.HOME
  FollowersOnly -> GqlVisibility.FOLLOWERS
  Direct -> GqlVisibility.DIRECT

createPost :: { text :: String, visibility :: Visibility } -> Aff (Either ApiError Post)
createPost input =
  run (\(raw :: { createPost :: RawInnerPost }) -> toInnerPost raw.createPost)
    $ fullRes <$> mutationJson identity mutationClient "CreatePost"
        { createPost: { input: { text: input.text, visibility: postVisibility input.visibility } } `Args` innerPostSelection }

-- Quick reaction (D03). profileId is always the acting Profile the client holds, so
-- a response is applied only if that Profile is still the acting one.

type EmojiSelection =
  { kind :: Unit
  , value :: Unit
  , shortcode :: Unit
  , imageUrl :: Unit
  , available :: Unit
  , unavailableReason :: Unit
  , origin :: Unit
  , imageState :: Unit
  , usage :: Unit
  }

emojiSelection :: EmojiSelection
emojiSelection = { kind: unit, value: unit, shortcode: unit, imageUrl: unit, available: unit, unavailableReason: unit, origin: unit, imageState: unit, usage: unit }

type RawEmoji =
  { kind :: GqlEmojiKind.EmojiKind
  , value :: String
  , shortcode :: Maybe String
  , imageUrl :: Maybe String
  , available :: Boolean
  , unavailableReason :: Maybe GqlReason.EmojiUnavailableReason
  , origin :: Maybe String
  , imageState :: Maybe GqlImageState.EmojiImageState
  , usage :: Maybe GqlUsage.EmojiUsage
  }

toEmoji :: RawEmoji -> Emoji
toEmoji raw =
  { kind: case raw.kind of
      GqlEmojiKind.UNICODE -> UnicodeEmoji
      GqlEmojiKind.CUSTOM -> CustomEmoji
  , value: raw.value
  , shortcode: raw.shortcode
  , imageUrl: raw.imageUrl
  , available: raw.available
  , unavailableReason: raw.unavailableReason <#> case _ of
      GqlReason.DELETED -> Deleted
      GqlReason.DISABLED -> Disabled
  , origin: raw.origin
  , imageState: raw.imageState <#> case _ of
      GqlImageState.PRESENT -> ImagePresent
      GqlImageState.MISSING -> ImageMissing
  , usage: raw.usage <#> case _ of
      GqlUsage.ANYWHERE -> Anywhere
      GqlUsage.EXISTING_REACTION_ONLY -> ExistingReactionOnly
  }

emojiInput :: Emoji -> { kind :: GqlEmojiKind.EmojiKind, value :: String }
emojiInput emoji =
  { kind: case emoji.kind of
      UnicodeEmoji -> GqlEmojiKind.UNICODE
      CustomEmoji -> GqlEmojiKind.CUSTOM
  , value: emoji.value
  }

type RawSettings = { profileId :: ID, revision :: Int, favorites :: Array RawEmoji }

settingsSelection :: { profileId :: Unit, revision :: Unit, favorites :: EmojiSelection }
settingsSelection = { profileId: unit, revision: unit, favorites: emojiSelection }

toSettings :: RawSettings -> QuickSettings
toSettings raw = { profileId: unwrap raw.profileId, revision: raw.revision, favorites: map toEmoji raw.favorites }

fetchQuickSettings :: String -> Aff (Either ApiError QuickSettings)
fetchQuickSettings profileId =
  run (\(raw :: { quickReactionSettings :: RawSettings }) -> toSettings raw.quickReactionSettings)
    $ queryFullRes decodeJson identity queryClient "QuickReactionSettings"
        { quickReactionSettings: { profileId: ID profileId } `Args` settingsSelection }

-- | PUT with the revision the client last saw (409 is RevisionConflict).
saveQuickSettings :: String -> Int -> Array Emoji -> Aff (Either ApiError QuickSettings)
saveQuickSettings profileId revision favorites =
  run (\(raw :: { updateQuickReactionSettings :: RawSettings }) -> toSettings raw.updateQuickReactionSettings)
    $ fullRes <$> mutationJson identity mutationClient "UpdateQuickReactionSettings"
        { updateQuickReactionSettings:
            { profileId: ID profileId, expectedRevision: revision, favorites: map emojiInput favorites } `Args` settingsSelection
        }

type RawPostReactions =
  { noteId :: ID
  , mine :: Maybe RawEmoji
  , others :: Array { emoji :: RawEmoji, count :: Int, reactors :: Array { id :: ID, handle :: String, displayName :: String } }
  }

fetchPostReactions :: String -> Array String -> Aff (Either ApiError (Array PostReactions))
fetchPostReactions profileId noteIds =
  run (\(raw :: { postReactions :: Array RawPostReactions }) -> map convert raw.postReactions)
    $ queryFullRes decodeJson identity queryClient "PostReactions"
        { postReactions: { profileId: ID profileId, noteIds: map ID noteIds } `Args`
            { noteId: unit
            , mine: emojiSelection
            , others: { emoji: emojiSelection, count: unit, reactors: { id: unit, handle: unit, displayName: unit } }
            }
        }
  where
  convert raw =
    { noteId: unwrap raw.noteId
    , mine: map toEmoji raw.mine
    , others: raw.others <#> \group ->
        { emoji: toEmoji group.emoji
        , count: group.count
        , reactors: group.reactors <#> \reactor -> { id: unwrap reactor.id, handle: reactor.handle, displayName: reactor.displayName }
        }
    }

-- | PROVISIONAL: the server's custom emoji (real mode: NotImplemented).
fetchCustomEmojis :: Aff (Either ApiError (Array Emoji))
fetchCustomEmojis =
  run (\(raw :: { customEmojis :: Array RawEmoji }) -> map toEmoji raw.customEmojis)
    $ queryFullRes decodeJson identity queryClient "CustomEmojis" { customEmojis: emojiSelection }

setNoteReaction :: String -> String -> Emoji -> Aff (Either ApiError (Maybe Emoji))
setNoteReaction profileId noteId emoji =
  run (\(raw :: { setNoteReaction :: { emoji :: Maybe RawEmoji } }) -> map toEmoji raw.setNoteReaction.emoji)
    $ fullRes <$> mutationJson identity mutationClient "SetNoteReaction"
        { setNoteReaction: { profileId: ID profileId, noteId: ID noteId, emoji: emojiInput emoji } `Args` { emoji: emojiSelection } }

removeNoteReaction :: String -> String -> Aff (Either ApiError Unit)
removeNoteReaction profileId noteId =
  run (\(_ :: { removeNoteReaction :: { noteId :: ID } }) -> unit)
    $ fullRes <$> mutationJson identity mutationClient "RemoveNoteReaction"
        { removeNoteReaction: { profileId: ID profileId, noteId: ID noteId } `Args` { noteId: unit } }
