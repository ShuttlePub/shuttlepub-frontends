module App.View where

import App.Message (Message)
import App.Model (Model, PageModel(..))
import App.View.AccountDetail as AccountDetail
import App.View.AccountNew as AccountNew
import App.View.Accounts as Accounts
import App.View.Admin as Admin
import App.View.Layout as Layout
import App.View.Login as Login
import ShuttlePub.UI.NotFound as NotFound
import App.View.Settings as Settings
import Flame (Html)

view :: Model -> Html Message
view model = Layout.page model
  [ case model.page of
      Home -> Accounts.view model.accounts model.errorMessage
      Login -> Login.view model.loginForm model.errorMessage model.savePending
      Settings -> Settings.view model
      AccountNew -> AccountNew.view model.newAccountForm model.errorMessage model.savePending
      AccountDetail -> AccountDetail.view model.selectedAccount model.editProfileForm model.editMetadataForm model.errorMessage model.savePending
      AdminRegistration -> Admin.registrationPage model
      AdminWebhook -> Admin.webhookPage model
      NotFound -> NotFound.notFound
  ]
