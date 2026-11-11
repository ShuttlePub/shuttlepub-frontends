module Client.Update where

import Prelude

import App.Api.Error (ApiError(..))
import App.Api.GraphQL (fetchApiMode, fetchApiStatus, fetchProfileContext)
import App.Message (Message(..))
import App.Model (Model, RemoteData(..), fromEither)
import App.MuteBlock.Types as MuteBlock
import App.MuteBlock.Update as MuteBlockUpdate
import App.Route (Route(..), routeCodec)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff)
import Effect.Class (liftEffect)
import Flame (Update, noMessages)
import Foreign (unsafeToForeign)
import Routing.Duplex (print)
import Routing.PushState (PushStateInterface)

-- | Hydrated is sent once right after resumeMount: it flips the hydration
-- | marker (the observable proof that the client took over from SSR) and starts
-- | the data requests. Responses, including failures, are stored as received.
mkUpdate :: PushStateInterface -> Update Model Message
mkUpdate nav model = case _ of
  Navigate route ->
    Tuple model
      [ liftEffect (nav.pushState (unsafeToForeign {}) (print routeCodec route)) $> Nothing ]
  UrlChanged route ->
    enterMuteBlock (model { route = route })
  Hydrated ->
    Tuple
      model
        { isHydrated = true
        , apiMode = Loading
        , apiStatus = Loading
        , profileContext = Loading
        }
      [ Just <<< ApiModeLoaded <$> fetchApiMode
      , Just <<< ApiStatusLoaded <$> fetchApiStatus
      , Just <<< ProfileContextLoaded <$> fetchProfileContext
      ]
  ApiModeLoaded result ->
    noMessages $ model { apiMode = fromEither result }
  ApiStatusLoaded result ->
    noMessages $ model { apiStatus = fromEither result }
  ProfileContextLoaded result ->
    enterMuteBlock (model { profileContext = fromEither result, muteBlock = model.muteBlock { profileKnown = false } })
  MuteBlockMsg (MuteBlock.Go tab) ->
    mkUpdate nav model (Navigate (if tab == MuteBlock.AccountsTab then MuteBlockAccounts else MuteBlockDomains))
  MuteBlockMsg message -> delegate model message

-- | The mute/block page loads its lists once it is shown and the selected
-- | Profile is known (a failed Profile context is shown as the page's error).
enterMuteBlock :: Model -> Tuple Model (Array (Aff (Maybe Message)))
enterMuteBlock model
  | onMuteBlock model.route && not model.muteBlock.profileKnown = case model.profileContext of
      Loaded context -> delegate model (MuteBlock.ProfileKnown (Right (map _.id context.activeProfile)))
      Failed error -> delegate model (MuteBlock.ProfileKnown (Left (failureOf error)))
      _ -> noMessages model
  | otherwise = noMessages model

onMuteBlock :: Maybe Route -> Boolean
onMuteBlock = case _ of
  Just MuteBlockAccounts -> true
  Just MuteBlockDomains -> true
  _ -> false

delegate :: Model -> MuteBlock.Message -> Tuple Model (Array (Aff (Maybe Message)))
delegate model message =
  let
    Tuple next effects = MuteBlockUpdate.update model.muteBlock message
  in
    Tuple model { muteBlock = next } (map (map (map MuteBlockMsg)) effects)

failureOf :: ApiError -> MuteBlock.Failure
failureOf = MuteBlock.Failure <<< case _ of
  Unauthenticated _ -> "UNAUTHENTICATED"
  Forbidden _ -> "FORBIDDEN"
  ProfileUnavailable _ -> "PROFILE_UNAVAILABLE"
  NotImplemented _ -> "NOT_IMPLEMENTED"
  Unavailable _ -> "UPSTREAM_UNAVAILABLE"
  NetworkError _ -> "NETWORK"
  _ -> "UPSTREAM_ERROR"
