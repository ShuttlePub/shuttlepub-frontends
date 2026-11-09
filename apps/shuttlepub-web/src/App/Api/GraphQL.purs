module App.Api.GraphQL
  ( fetchApiMode
  , fetchApiStatus
  , fetchProfileContext
  ) where

import Prelude

import App.Api.Error (ApiError(..), fromGqlCode)
import App.Model (ApiStatus)
import App.Profile (ProfileContext)
import Data.Argonaut.Decode (decodeJson, printJsonDecodeError)
import Data.Array (head)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Effect.Aff (Aff, message, try)
import Foreign.Object as FO
import Generated.Schema.Gql (Query)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)
import GraphQL.Client.BaseClients.Affjax.Web (AffjaxWebClient(..))
import GraphQL.Client.GqlError (GqlError)
import GraphQL.Client.Query (queryFullRes)
import GraphQL.Client.Types (Client(..), GqlRes)
import Type.Data.List (Nil')
import Type.Proxy (Proxy)

-- | Typed against the PureScript types generated from bff/schema.graphql
-- | (src/Generated, never hand-edited): a query naming a field that is not in
-- | the SDL does not compile.
queryClient :: Client AffjaxWebClient { directives :: Proxy Nil', query :: Query | () }
queryClient = Client (AffjaxWebClient "/graphql" [])

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
errorFromGql { message: text, extensions } = fromGqlCode (extensions >>= extensionCode) text
  where
  extensionCode exts = FO.lookup "code" exts >>= \json -> case decodeJson json of
    Right code -> Just code
    Left _ -> Nothing

fetchApiMode :: Aff (Either ApiError ApiMode)
fetchApiMode = do
  result <- try $ queryFullRes decodeJson identity queryClient "ApiMode"
    { apiMode: unit }
  pure $ case result of
    Left affError -> Left (NetworkError (message affError))
    Right gqlRes -> map _.apiMode (gqlResToEither gqlRes)

fetchApiStatus :: Aff (Either ApiError ApiStatus)
fetchApiStatus = do
  result <- try $ queryFullRes decodeJson identity queryClient "ApiStatus"
    { apiStatus: { apiVersion: unit } }
  pure $ case result of
    Left affError -> Left (NetworkError (message affError))
    Right gqlRes -> map _.apiStatus (gqlResToEither gqlRes)

fetchProfileContext :: Aff (Either ApiError ProfileContext)
fetchProfileContext = do
  result <- try $ queryFullRes decodeJson identity queryClient "ProfileContext"
    { profileContext: { activeProfile: { id: unit, handle: unit, displayName: unit } } }
  pure $ case result of
    Left affError -> Left (NetworkError (message affError))
    Right gqlRes -> map (\raw -> { activeProfile: map unwrapProfile raw.profileContext.activeProfile }) (gqlResToEither gqlRes)
  where
  unwrapProfile p = { id: unwrap p.id, handle: p.handle, displayName: p.displayName }
