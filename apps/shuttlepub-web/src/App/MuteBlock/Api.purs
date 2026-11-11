-- | GraphQL calls of the mute/block settings page. Typed against the
-- | PureScript types generated from bff/schema.graphql (src/Generated).
-- | GraphQL errors always win over data and keep their `extensions.code`.
module App.MuteBlock.Api
  ( fetchDomainControls
  , fetchActorPolicies
  , fetchImpact
  , checkDomain
  , setDomainControl
  , removeDomainControl
  , addActorPolicy
  , removeActorPolicy
  ) where

import Prelude

import App.MuteBlock.Types (ActorPolicy, DomainControl, Failure(..), Impact)
import Data.Argonaut.Decode (decodeJson)
import Data.Array (head)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Effect.Aff (Aff, try)
import Foreign.Object as FO
import Generated.Schema.Gql (Mutation, Query)
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode)
import GraphQL.Client.Args ((=>>))
import GraphQL.Client.BaseClients.Affjax.Web (AffjaxWebClient(..))
import GraphQL.Client.ID (ID(..))
import GraphQL.Client.Query (mutationFullRes, queryFullRes)
import GraphQL.Client.Types (Client(..), GqlRes)
import Type.Data.List (Nil')
import Type.Proxy (Proxy)

queryClient :: Client AffjaxWebClient { directives :: Proxy Nil', query :: Query | () }
queryClient = Client (AffjaxWebClient "/graphql" [])

-- | graphql-client 10.1.1's mutationFullRes types the client with `query :: schema`
-- | and then calls mutationJson, which needs `mutation :: schema`: both name Mutation.
mutationClient :: Client AffjaxWebClient { directives :: Proxy Nil', query :: Mutation, mutation :: Mutation }
mutationClient = Client (AffjaxWebClient "/graphql" [])

toEither :: forall a. GqlRes a -> Either Failure a
toEither { data_, errors } = case errors of
  Just errs -> case head errs of
    Just first -> Left (Failure (codeOf first.extensions))
    Nothing -> Left (Failure "UNEXPECTED")
  Nothing -> case data_ of
    Left _ -> Left (Failure "INVALID_RESPONSE")
    Right value -> Right value
  where
  codeOf extensions = case extensions >>= FO.lookup "code" of
    Just json -> case decodeJson json of
      Right code -> code
      Left _ -> "UNEXPECTED"
    Nothing -> "UNEXPECTED"

run :: forall a b. (a -> b) -> Aff (GqlRes a) -> Aff (Either Failure b)
run convert request = do
  result <- try request
  pure $ case result of
    Left _ -> Left (Failure "NETWORK")
    Right res -> map convert (toEither res)

controlFields :: { domain :: Unit, mode :: Unit, revision :: Unit, createdAt :: Unit }
controlFields = { domain: unit, mode: unit, revision: unit, createdAt: unit }

actorFields :: { id :: Unit, mode :: Unit, actorUrl :: Unit, createdAt :: Unit }
actorFields = { id: unit, mode: unit, actorUrl: unit, createdAt: unit }

toActor :: { id :: ID, mode :: PolicyMode, actorUrl :: String, createdAt :: String } -> ActorPolicy
toActor raw = { id: unwrap raw.id, mode: raw.mode, actorUrl: raw.actorUrl, createdAt: raw.createdAt }

fetchDomainControls :: String -> Aff (Either Failure (Array DomainControl))
fetchDomainControls profile = run _.domainControls $ queryFullRes decodeJson identity queryClient "DomainControls"
  { domainControls: { profile: ID profile } =>> controlFields }

fetchActorPolicies :: String -> Aff (Either Failure (Array ActorPolicy))
fetchActorPolicies profile = run (map toActor <<< _.actorPolicies) $ queryFullRes decodeJson identity queryClient "ActorPolicies"
  { actorPolicies: { profile: ID profile } =>> actorFields }

fetchImpact :: String -> String -> Aff (Either Failure Impact)
fetchImpact profile domain = run (\raw -> { following: raw.domainBlockImpact.following, followers: raw.domainBlockImpact.followers })
  $ queryFullRes decodeJson identity queryClient "DomainBlockImpact"
      { domainBlockImpact: { profile: ID profile, domain } =>> { following: unit, followers: unit } }

checkDomain :: String -> Aff (Either Failure { domain :: Maybe String, error :: Maybe String })
checkDomain input = run (\raw -> { domain: raw.checkDomainInput.domain, error: map show raw.checkDomainInput.error })
  $ queryFullRes decodeJson identity queryClient "CheckDomainInput"
      { checkDomainInput: { input } =>> { domain: unit, error: unit } }

setDomainControl :: String -> String -> PolicyMode -> Maybe Int -> Aff (Either Failure DomainControl)
setDomainControl profile domain mode expected = case expected of
  Nothing -> run _.setDomainControl $ mutationFullRes decodeJson identity mutationClient "SetDomainControl"
    { setDomainControl: { profile: ID profile, domain, mode } =>> controlFields }
  Just revision -> run _.setDomainControl $ mutationFullRes decodeJson identity mutationClient "ReplaceDomainControl"
    { setDomainControl: { profile: ID profile, domain, mode, expectedRevision: revision } =>> controlFields }

removeDomainControl :: String -> String -> Int -> Aff (Either Failure String)
removeDomainControl profile domain revision = run _.removeDomainControl.key
  $ mutationFullRes decodeJson identity mutationClient "RemoveDomainControl"
      { removeDomainControl: { profile: ID profile, domain, expectedRevision: revision } =>> { key: unit } }

addActorPolicy :: String -> String -> PolicyMode -> Aff (Either Failure ActorPolicy)
addActorPolicy profile actorUrl mode = run (toActor <<< _.addActorPolicy)
  $ mutationFullRes decodeJson identity mutationClient "AddActorPolicy"
      { addActorPolicy: { profile: ID profile, actorUrl, mode } =>> actorFields }

removeActorPolicy :: String -> String -> PolicyMode -> Aff (Either Failure String)
removeActorPolicy profile id mode = run _.removeActorPolicy.key
  $ mutationFullRes decodeJson identity mutationClient "RemoveActorPolicy"
      { removeActorPolicy: { profile: ID profile, id: ID id, mode } =>> { key: unit } }
