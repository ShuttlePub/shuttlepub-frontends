module App.Message where

import App.Api.Error (ApiError)
import App.Model (ApiStatus)
import App.Profile (ProfileContext)
import App.Route (Route)
import Data.Either (Either)
import Data.Maybe (Maybe)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)

data Message
  = Navigate Route
  | UrlChanged (Maybe Route)
  | Hydrated
  | ApiModeLoaded (Either ApiError ApiMode)
  | ApiStatusLoaded (Either ApiError ApiStatus)
  | ProfileContextLoaded (Either ApiError ProfileContext)
