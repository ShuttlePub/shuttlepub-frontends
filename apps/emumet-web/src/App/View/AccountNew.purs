module App.View.AccountNew where

import Prelude

import App.Message (Message(..))
import App.Model (DialogStep(..), NewAccountForm, RemoteData)
import App.Username (isAvailable)
import App.View.UsernameUi as U
import Data.Maybe (Maybe)
import Data.String.Common (trim)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Theme as T

-- | The create modal, shown over the account list. First the inputs; Create then
-- | switches to the "cannot be changed" confirmation in the same dialog.
modal :: NewAccountForm -> Maybe String -> RemoteData String -> Boolean -> Html Message
modal form errorMsg host savePending =
  case form.step of
    StepConfirm ->
      U.modalFrame "new-account-title" "confirm"
        (U.confirmBody "new-account-title" "この ID で作成しますか？" (if savePending then "作成中..." else "作成") (U.hostText host) form.username.value BackNewAccount SubmitNewAccount)
    StepInput ->
      U.modalFrame "new-account-title" "input"
        [ U.modalTitle "new-account-title" "New Account"
        , U.errorBanner errorMsg
        , HE.div [ HA.class' "space-y-3 sm:space-y-4" ]
            [ accountNameField form
            , U.usernameInput "new" false form.username host SetNewAccountUsername
            , botField form
            ]
        , U.buttonRow
            [ U.outlineButton "キャンセル" CloseNewAccount
            , U.primaryButton "作成" (not canReview) ReviewNewAccount
            ]
        ]
  where
  canReview = trim form.name /= "" && isAvailable form.username.value form.username.verdict && U.hostReady host && not savePending

accountNameField :: NewAccountForm -> Html Message
accountNameField form =
  HE.div [ HA.class' "space-y-1.5" ]
    [ HE.label [ HA.for "new-account-name", HA.class' ("block text-sm font-medium " <> T.textPrimary) ] [ HE.text "Account 名" ]
    , HE.input
        [ HA.id "new-account-name"
        , HA.type' "text"
        , HA.class' ("w-full px-3 py-2 text-sm border " <> T.borderTheme <> " " <> T.bgSurface <> " " <> T.textPrimary <> " " <> T.roundedTheme <> " focus:outline-none focus:ring-2 focus:ring-accent/50")
        , HA.value form.name
        , HA.onInput SetNewAccountName
        , HA.createAttribute "autocomplete" "off"
        , HA.createAttribute "data-initial-focus" "true"
        ]
    ]

botField :: NewAccountForm -> Html Message
botField form =
  HE.label [ HA.class' ("flex cursor-pointer items-center gap-2.5 text-sm " <> T.textSecondary) ]
    [ HE.input
        [ HA.class' "h-4 w-4 accent-accent"
        , HA.type' "checkbox"
        , HA.checked form.isBot
        , HA.onCheck SetNewAccountIsBot
        ]
    , HE.text "Bot"
    ]
