module App.View.UsernameUi where

import Prelude

import App.Message (Message(..))
import App.Model (RemoteData(..), UsernameField)
import App.Route (Route(..), routeCodec)
import App.Username (Status(..), status)
import Data.Maybe (Maybe(..), maybe)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Routing.Duplex (print)
import ShuttlePub.UI.Theme as T

-- | The host is shown and confirmed only once it is known.
hostText :: RemoteData String -> Maybe String
hostText = case _ of
  Loaded h -> Just h
  _ -> Nothing

hostReady :: RemoteData String -> Boolean
hostReady = case _ of
  Loaded _ -> true
  _ -> false

-- | Primary / secondary buttons used inside the username dialogs. The primary
-- | button's label is dark for contrast on the accent colour (spec B v3).
primaryButton :: String -> Boolean -> Message -> Html Message
primaryButton label disabled onClick =
  HE.button
    [ HA.type' "button"
    , HA.class' ("px-3 sm:px-3.5 py-2 text-sm font-medium text-bg-secondary " <> T.bgAccent <> " " <> T.hoverBgAccent <> " " <> T.roundedTheme <> " transition-colors disabled:opacity-45 disabled:cursor-not-allowed")
    , HA.onClick onClick
    , HA.disabled disabled
    ]
    [ HE.text label ]

-- | The dialog's cancel / back button. Escape clicks it (see Client/Dialog.js).
outlineButton :: String -> Message -> Html Message
outlineButton label onClick =
  HE.button
    [ HA.type' "button"
    , HA.class' ("px-3 sm:px-3.5 py-2 text-sm font-medium " <> T.textPrimary <> " border " <> T.borderTheme <> " " <> T.roundedTheme <> " hover:bg-bg-surface transition-colors")
    , HA.createAttribute "data-cancel" "true"
    , HA.onClick onClick
    ]
    [ HE.text label ]

-- | Like `outlineButton`, and also where the focus lands when the step opens
-- | (the confirmation step focuses the non-destructive choice).
backButton :: String -> Message -> Html Message
backButton label onClick =
  HE.button
    [ HA.type' "button"
    , HA.class' ("px-3 sm:px-3.5 py-2 text-sm font-medium " <> T.textPrimary <> " border " <> T.borderTheme <> " " <> T.roundedTheme <> " hover:bg-bg-surface transition-colors")
    , HA.createAttribute "data-cancel" "true"
    , HA.createAttribute "data-initial-focus" "true"
    , HA.onClick onClick
    ]
    [ HE.text label ]

-- | A real modal dialog (`<dialog>` + `showModal()` from Client/Dialog.js): the browser makes the
-- | rest of the page inert, keeps Tab inside, and Escape / focus restoration are handled by the same
-- | script. Before the script runs (SSR) a closed dialog is simply not displayed.
modalFrame :: String -> String -> Array (Html Message) -> Html Message
modalFrame titleId step children =
  HE.createElement "dialog"
    [ HA.class' "m-0 h-full max-h-none w-full max-w-none items-start justify-center border-0 bg-transparent px-2 pt-3 text-inherit open:flex sm:px-4 sm:pt-16 backdrop:bg-black/60"
    , HA.createAttribute "data-username-dialog" "true"
    , HA.createAttribute "data-step" step
    , HA.createAttribute "aria-labelledby" titleId
    ]
    [ HE.div [ HA.class' (T.surface <> " w-full max-w-lg p-4 sm:p-5") ] children ]

modalTitle :: String -> String -> Html Message
modalTitle titleId text =
  HE.h2 [ HA.id titleId, HA.class' ("mb-2 text-lg font-semibold " <> T.textHeading) ] [ HE.text text ]

buttonRow :: Array (Html Message) -> Html Message
buttonRow children =
  HE.div [ HA.class' "mt-4 flex justify-end gap-2 [&>button]:max-sm:flex-1" ] children

-- | The "cannot be changed" confirmation: the finished ID and one line. No checkbox.
confirmBody :: String -> String -> String -> Maybe String -> String -> Message -> Message -> Array (Html Message)
confirmBody titleId title goLabel host username onBack onGo =
  [ modalTitle titleId title
  , HE.div [ HA.class' ("mb-2 break-all font-mono text-[1.0625rem] " <> T.textHeading), HA.id "username-confirm-id" ]
      [ HE.text (acct host username) ]
  , HE.p [ HA.class' ("text-sm " <> T.textSecondary) ] [ HE.text "後から変更できません。" ]
  , buttonRow
      [ backButton "戻る" onBack
      , primaryButton goLabel false onGo
      ]
  ]

-- | @name@host (the confirmation is reachable only when the host is known).
acct :: Maybe String -> String -> String
acct host username = "@" <> username <> maybe "" (\h -> "@" <> h) host

-- | The username input: label with a (?) link to the help page, "@" before and "@host" after
-- | (the host is dropped on narrow screens), and one status line below.
-- | `initialFocus` marks the input as where the focus lands when the dialog opens.
usernameInput :: String -> Boolean -> UsernameField -> RemoteData String -> (String -> Message) -> Html Message
usernameInput idPrefix initialFocus field host onInput =
  let
    inputId = idPrefix <> "-username"
    capId = idPrefix <> "-username-status"
    st = status field.value field.verdict
    hostFailed = case host of
      Failed -> true
      _ -> false
    groupTone = case st of
      Unusable _ -> " border-error"
      Available -> " border-success/70"
      _ -> " border-border"
  in
    HE.div [ HA.class' "space-y-1.5" ]
      [ HE.div [ HA.class' "flex items-center" ]
          [ HE.label [ HA.for inputId, HA.class' ("text-sm font-medium " <> T.textPrimary) ] [ HE.text "ユーザー名" ]
          , hint
          ]
      , HE.div [ HA.class' ("flex items-stretch overflow-hidden border " <> T.bgSurface <> " " <> T.roundedTheme <> " focus-within:ring-2 focus-within:ring-accent/50" <> groupTone), HA.id (idPrefix <> "-username-group") ]
          [ HE.span [ HA.class' affix, HA.createAttribute "aria-hidden" "true" ] [ HE.text "@" ]
          , HE.input
              ( [ HA.id inputId
                , HA.type' "text"
                , HA.class' ("min-w-0 flex-1 bg-transparent px-2 py-2 font-mono text-sm outline-none " <> T.textPrimary)
                , HA.value field.value
                , HA.onInput onInput
                , HA.createAttribute "autocomplete" "off"
                , HA.createAttribute "autocapitalize" "none"
                , HA.createAttribute "spellcheck" "false"
                , HA.createAttribute "maxlength" "80"
                , HA.createAttribute "aria-describedby" capId
                , HA.createAttribute "aria-invalid"
                    ( case st of
                        Unusable _ -> "true"
                        _ -> "false"
                    )
                ] <> if initialFocus then [ HA.createAttribute "data-initial-focus" "true" ] else []
              )
          , case host of
              Loaded h -> HE.span [ HA.class' (affix <> " max-sm:hidden"), HA.createAttribute "aria-hidden" "true" ] [ HE.text ("@" <> h) ]
              _ -> HE.span [ HA.class' "hidden" ] []
          ]
      , HE.div [ HA.id capId, HA.class' "min-h-4 text-xs", HA.createAttribute "aria-live" "polite" ]
          [ if hostFailed then hostFailure else statusLine st ]
      ]
  where
  affix = "flex items-center whitespace-nowrap bg-bg-primary px-2.5 py-2 text-sm " <> T.textMuted

-- | The host part of the ID could not be fetched: nothing can be confirmed until it can.
hostFailure :: Html Message
hostFailure =
  HE.span [ HA.class' ("inline-flex items-center gap-2 " <> T.textWarning) ]
    [ HE.text "ホスト名を取得できませんでした"
    , HE.button
        [ HA.type' "button"
        , HA.class' ("underline " <> T.textAccent <> " hover:opacity-80")
        , HA.onClick RetryInstanceHost
        ]
        [ HE.text "再取得" ]
    ]

-- | (?) next to the label: a real link to the help page (new tab, so the typed value is kept).
hint :: Html Message
hint =
  HE.a
    [ HA.href (print routeCodec UsernameHelp)
    , HA.createAttribute "target" "_blank"
    , HA.createAttribute "rel" "noopener"
    , HA.class' ("ml-1 inline-flex h-[18px] w-[18px] items-center justify-center border text-[0.6875rem] no-underline " <> T.textMuted <> " " <> T.borderTheme <> " rounded-full hover:opacity-80")
    , HA.createAttribute "aria-label" "ユーザー名のヘルプ (新しいタブで開く)"
    , HA.createAttribute "title" "ユーザー名のヘルプ"
    ]
    [ HE.text "?" ]

statusLine :: Status -> Html Message
statusLine = case _ of
  NoStatus -> HE.span [ HA.class' "hidden" ] []
  Checking ->
    HE.span [ HA.class' ("inline-flex items-center gap-1.5 " <> T.textSecondary) ]
      [ HE.span [ HA.class' "inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent", HA.createAttribute "aria-hidden" "true" ] []
      , HE.text "確認しています"
      ]
  Available -> HE.span [ HA.class' T.textSuccess ] [ HE.text "✓ 利用できます" ]
  Unusable msg -> HE.span [ HA.class' T.textError ] [ HE.text ("✕ " <> msg) ]

errorBanner :: Maybe String -> Html Message
errorBanner = case _ of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just msg ->
    HE.div [ HA.class' ("mb-3 px-3 py-2 text-sm " <> T.roundedTheme <> " " <> T.textError <> " border " <> T.borderTheme <> " bg-red-500/10") ]
      [ HE.text msg ]
