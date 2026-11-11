module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
import Generated.Schema.Gql.Enum.DomainInputError (DomainInputError)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode)
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
  , checkDomainInput ::
      { input :: NotNull (AsGql "String" String) }
      ->
      -- | Normalizes a typed domain (URL, @user@host, path, port, case, trailing dot, IDN).
      AsGql "DomainInputCheck" DomainInputCheck
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
  , domainBlockImpact ::
      { domain :: NotNull (AsGql "String" String)
      , profile :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | Follows that a block of this exact domain would detach (pending and accepted).
      AsGql "DomainBlockImpact" DomainBlockImpact
  }

derive instance Data.Newtype.Newtype Query _
newtype Mutation = Mutation
  { selectProfile ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | Select an identity from the current viewer's owned Emumet accounts (integrated Profile API).
      AsGql "ProfileContext" ProfileContext
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
  }

derive instance Data.Newtype.Newtype Mutation _
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
-- | Individual mute/block of the selected Profile. Emumet exposes only the target's canonical actor URL.
newtype ActorPolicy = ActorPolicy
  { actorUrl :: {} -> AsGql "String" String
  , createdAt :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , mode :: {} -> AsGql "PolicyMode" PolicyMode
  }

derive instance Data.Newtype.Newtype ActorPolicy _
-- | Maps GET /api/v1/status (operation getApiStatus).
newtype ApiStatus = ApiStatus { apiVersion :: {} -> AsGql "String" String }

derive instance Data.Newtype.Newtype ApiStatus _
-- | Result of normalizing what the viewer typed: exactly one of domain / error is set.
newtype DomainInputCheck = DomainInputCheck
  { domain :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , error ::
      {} -> AsGql "DomainInputError" (Data.Maybe.Maybe (AsGql "DomainInputError" DomainInputError))
  }

derive instance Data.Newtype.Newtype DomainInputCheck _
-- | The Profile the viewer is currently acting as. Null when there is none.
newtype ProfileContext = ProfileContext
  { activeProfile :: {} -> AsGql "Profile" (Data.Maybe.Maybe (AsGql "Profile" Profile)) }

derive instance Data.Newtype.Newtype ProfileContext _
