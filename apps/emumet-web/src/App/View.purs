module App.View where

import App.Message (Message)
import App.Model (Model, PageModel(..))
import App.View.AccountDetail as AccountDetail
import App.View.AccountNew as AccountNew
import App.View.Accounts as Accounts
import App.View.Layout as Layout
import App.View.Login as Login
import ShuttlePub.UI.NotFound as NotFound
import App.View.Settings as Settings
import App.View.UsernameHelp as UsernameHelp
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

view :: Model -> Html Message
view model = Layout.page model
  [ case model.page of
      -- Home and the create modal share one structure (the list, then a modal slot) so opening the modal
      -- is a patch of that slot only (/accounts/new is the list with the modal open)
      Home -> HE.div_
        [ Accounts.view model.accounts model.errorMessage model.instanceHost
        , HE.div [ HA.class' "hidden" ] []
        ]
      Login -> Login.view model.loginForm model.errorMessage model.savePending
      Settings -> Settings.view model
      AccountNew -> HE.div_
        [ Accounts.view model.accounts Nothing model.instanceHost
        , AccountNew.modal model.newAccountForm model.errorMessage model.instanceHost model.savePending
        ]
      AccountDetail -> AccountDetail.view model.selectedAccount model.editProfileForm model.editMetadataForm model.setUsernameDialog model.instanceHost model.errorMessage model.savePending
      UsernameHelp -> UsernameHelp.view
      NotFound -> NotFound.notFound
  ]
