module App.Message where

import App.Api.Error (ApiError)
import App.Dom (KeyAction)
import App.Model (ApiStatus, DetailTab, PostDetailData)
import App.Post (Post, PostView, TimelineTab, UserPage, Visibility)
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
  -- | Content answers carry the content epoch they were requested in (App.Model ContentState).
  | TimelineLoaded TimelineTab Int (Either ApiError (Array Post))
  | PostDetailLoaded String Int (Either ApiError PostDetailData)
  | UserPageLoaded String Int (Either ApiError (Maybe UserPage))
  -- | ui-spec 3-1 / 3-2 / 3-5: [この投稿だけ表示] / [表示] and [隠す] (page-local, S8 reveal).
  | RevealPost String
  | PostRevealed String Int (Either ApiError (Maybe PostView))
  | HidePost String
  -- | ui-spec 3-5: "非表示の返信 n 件".
  | ToggleHiddenReplies
  -- | ui-spec 3-6: [投稿を表示] / [隠す] on a person's page.
  | RevealUserPosts
  | UserPostsRevealed String Int (Either ApiError (Maybe UserPage))
  | HideUserPosts
  -- | The "…" menu of a post card or a person's page: key and opener element id.
  | OpenPostMenu String String
  | ClosePostMenu
  -- | A menu item: closes the menu, then runs the mute/block action.
  | MenuAction MuteBlock.Message
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
