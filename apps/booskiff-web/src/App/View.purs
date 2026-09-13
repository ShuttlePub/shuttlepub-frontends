module App.View where

import App.Message (Message)
import App.Model (Model, PageModel(..))
import App.View.Drive as Drive
import App.View.FileDetail as FileDetail
import App.View.Layout as Layout
import App.View.Login as Login
import Flame (Html)
import ShuttlePub.UI.NotFound as NotFound

view :: Model -> Html Message
view model = Layout.page model
  [ case model.page of
      Login -> Login.view model.loginForm model.errorMessage model.busy
      Drive -> Drive.view model
      FileDetail fileId -> FileDetail.view fileId model
      NotFound -> NotFound.notFound
  ]
