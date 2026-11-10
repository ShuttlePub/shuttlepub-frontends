module Client.Update where

import Prelude

import App.Api.GraphQL (fetchApiMode, fetchApiStatus, fetchProfileContext)
import App.Message (Message(..))
import App.Model (Model, RemoteData(..), fromEither)
import App.Route (routeCodec)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
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
    noMessages $ model { route = route }
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
    noMessages $ model { profileContext = fromEither result }
