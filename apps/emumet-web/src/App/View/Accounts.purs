module App.View.Accounts where

import Prelude

import App.Api.GraphQL.Types (AccountResponse(..))
import App.Message (Message)
import App.Model (RemoteData(..))
import App.Route as Route
import App.View.UsernameUi as U
import App.View.Link as Link
import Data.Array (null) as Array
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String.CodeUnits (take)
import Data.String.Common (toUpper)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Theme as T

view :: RemoteData (Array AccountResponse) -> Maybe String -> RemoteData String -> Html Message
view accounts errorMsg hostData =
  HE.div [ HA.class' "space-y-2.5 sm:space-y-4" ]
    [ header
    , errorBanner errorMsg
    , accountsSection accounts (U.hostText hostData)
    ]

errorBanner :: Maybe String -> Html Message
errorBanner = case _ of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just msg ->
    HE.div [ HA.class' ("px-4 py-3 text-sm " <> T.roundedTheme <> " " <> T.textError <> " border " <> T.borderTheme <> " bg-red-500/10") ]
      [ HE.text msg ]

header :: Html Message
header =
  HE.div [ HA.class' "flex items-center justify-between" ]
    [ HE.h1 [ HA.class' ("text-xl sm:text-2xl font-bold tracking-tight " <> T.textHeading) ]
        [ HE.text "Accounts" ]
    , newAccountButton
    ]

-- | "＋": opens the create modal (the /accounts/new page is this list with the modal open).
newAccountButton :: Html Message
newAccountButton =
  Link.link Route.AccountNew
    [ HE.span
        [ HA.class' ("inline-flex h-9 w-9 items-center justify-center text-xl leading-none font-medium text-bg-secondary " <> T.bgAccent <> " " <> T.hoverBgAccent <> " " <> T.roundedTheme <> " transition-colors")
        , HA.createAttribute "role" "img"
        , HA.createAttribute "aria-label" "New Account"
        , HA.createAttribute "title" "New Account"
        ]
        [ HE.text "+" ]
    ]

accountsSection :: RemoteData (Array AccountResponse) -> Maybe String -> Html Message
accountsSection accounts host = case accounts of
  NotAsked ->
    HE.div [ HA.class' "hidden" ] []
  Loading ->
    HE.div [ HA.class' ("flex items-center gap-2 " <> T.textMuted) ]
      [ HE.text "Loading accounts..." ]
  Failed ->
    HE.div [ HA.class' ("flex items-center gap-2 " <> T.textError) ]
      [ HE.text "Failed to load accounts." ]
  Loaded accs ->
    if Array.null accs then HE.div [ HA.class' ("text-center py-12 " <> T.textMuted) ]
      [ HE.text "No accounts yet. Create one to get started." ]
    else HE.div [ HA.class' "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3" ]
      (map (accountCard host) accs)

-- | The @-handle is the Profile's username (never the Account name). A profile
-- | without one shows a short "not set" label instead.
accountCard :: Maybe String -> AccountResponse -> Html Message
accountCard host (AccountResponse acc) =
  let
    title = fromMaybe (fromMaybe acc.id acc.profileUsername) acc.displayName
  in
    Link.link (Route.AccountDetail acc.id)
      [ HE.div [ HA.class' (T.surface <> " p-3 sm:px-4 hover:border-accent transition-colors cursor-pointer") ]
          [ HE.div [ HA.class' "flex items-center gap-3" ]
              [ avatar title
              , HE.div [ HA.class' "min-w-0 flex-1" ]
                  [ HE.div [ HA.class' ("flex items-center truncate font-semibold " <> T.textPrimary) ]
                      [ HE.span [ HA.class' "truncate" ] [ HE.text title ]
                      , if acc.isBot then HE.span [ HA.class' ("ml-1.5 px-1.5 text-[0.6875rem] font-semibold text-bg-secondary " <> T.bgAccent <> " " <> T.roundedTheme) ]
                          [ HE.text "Bot" ]
                        else HE.text ""
                      ]
                  , handle host acc.profileId acc.profileUsername
                  ]
              ]
          ]
      ]

handle :: Maybe String -> Maybe String -> Maybe String -> Html Message
handle host profileId profileUsername = case profileUsername of
  Just name ->
    HE.div [ HA.class' ("truncate font-mono text-[0.8125rem] " <> T.textMuted) ]
      [ HE.text ("@" <> name <> maybe' "" (\h -> "@" <> h) host) ]
  Nothing -> case profileId of
    Just _ -> HE.div [ HA.class' ("text-[0.8125rem] " <> T.textWarning) ] [ HE.text "ユーザー名未設定" ]
    Nothing -> HE.text ""
  where
  maybe' d f = case _ of
    Nothing -> d
    Just x -> f x

avatar :: String -> Html Message
avatar name =
  HE.div [ HA.class' ("flex h-10 w-10 shrink-0 items-center justify-center text-base font-bold text-bg-secondary " <> T.bgAccent <> " " <> T.roundedThemeLg) ]
    [ HE.text (toUpper (take 1 name)) ]
