module App.Message where

import App.Api.Error (ApiError)
import App.Dom (KeyAction)
import App.Model (ApiStatus, DetailTab, PostDetailData)
import App.Post (Post, TimelineTab, Visibility)
import App.Profile (Profile, ProfileContext)
import App.MuteBlock.Types as MuteBlock
import App.Reaction (ReactionMsg)
import App.Route (Route)
import Data.Either (Either)
import Data.Maybe (Maybe)
import Generated.Schema.Gql.Enum.ApiMode (ApiMode)

data Message
  = Navigate Route
  | UrlChanged (Maybe Route)
  -- | Sent once right after resumeMount with the client clock and viewport.
  | Hydrated Number Boolean
  | ViewportChanged Boolean
  | ApiModeLoaded (Either ApiError ApiMode)
  | ApiStatusLoaded (Either ApiError ApiStatus)
  | ProfileContextLoaded (Either ApiError ProfileContext)
  | AvailableProfilesLoaded (Either ApiError (Array Profile))
  -- | Keyboard: the app's single keydown handler (App.Dom.keydownAction).
  | KeyPressed KeyAction
  -- | Escape pressed while focus is outside the app root (document subscription).
  | DocumentEscape
  | SelectTimelineTab TimelineTab
  | TimelineLoaded TimelineTab (Either ApiError (Array Post))
  | PostDetailLoaded String (Either ApiError PostDetailData)
  | SelectDetailTab DetailTab
  -- | Compose form (ui-spec L2). The String is the opener's element id.
  | OpenCompose String
  | CloseCompose
  | ComposeInput String
  | ComposeSurfaceClicked
  | ToggleVisibilityMenu
  | SetVisibility Visibility
  | SubmitPost
  | PostSubmitted (Either ApiError Post)
  -- | Profile switcher (ui-spec L1). The String is the opener's element id.
  | ToggleProfileMenu String
  | CloseProfileMenu
  | SelectProfile String
  | ProfileSelected (Either ApiError ProfileContext)
  | Logout
  -- | Quick reaction (D03): App.Reaction / Client.Reaction.
  | Reaction ReactionMsg
  | NoOp
  | MuteBlockMsg MuteBlock.Message
