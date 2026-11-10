module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
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
  }

derive instance Data.Newtype.Newtype Query _
newtype Mutation = Mutation
  { selectProfile ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      ->
      -- | Select an identity from the current viewer's owned Emumet accounts (integrated Profile API).
      AsGql "ProfileContext" ProfileContext
  }

derive instance Data.Newtype.Newtype Mutation _
-- | An owned Emumet integrated Account/Profile. id is its public Account nanoid; the current API does not expose an internal Profile id.
newtype Profile = Profile
  { displayName :: {} -> AsGql "String" String
  , handle :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Profile _
-- | Maps GET /api/v1/status (operation getApiStatus).
newtype ApiStatus = ApiStatus { apiVersion :: {} -> AsGql "String" String }

derive instance Data.Newtype.Newtype ApiStatus _
-- | The Profile the viewer is currently acting as. Null when there is none.
newtype ProfileContext = ProfileContext
  { activeProfile :: {} -> AsGql "Profile" (Data.Maybe.Maybe (AsGql "Profile" Profile)) }

derive instance Data.Newtype.Newtype ProfileContext _
