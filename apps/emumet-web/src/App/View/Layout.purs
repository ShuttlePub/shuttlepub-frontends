module App.View.Layout where

import Prelude

import App.Message (Message(..))
import App.Model (Model)
import App.Route (Route(..), isAdminRoute)
import App.View.Admin as Admin
import App.View.Link (link)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Layout as UI
import ShuttlePub.UI.Theme as T

page :: Model -> Array (Html Message) -> Html Message
page model content =
  if onAdminPage model then
    -- 管理画面の枠: 強制開放中の警告帯を nav の直下に出す (一般画面には出さない)。
    -- 中身の余白は ui-spec の表 (ページ余白 24 / 12) に合わせ、共有の UI.contentArea は変えない
    UI.shell
      [ nav model
      , Admin.overrideStrip model
      , HE.div [ HA.id "content", HA.class' "max-w-4xl mx-auto px-3 pt-3 pb-6 sm:px-6 sm:pt-6 sm:pb-8" ] content
      , Admin.bellBackdrop model.admin
      ]
  else
    UI.shell [ nav model, UI.contentArea content, Admin.bellBackdrop model.admin ]

onAdminPage :: Model -> Boolean
onAdminPage model = case model.route of
  Just r -> isAdminRoute r && isAdmin model
  Nothing -> false

isAdmin :: Model -> Boolean
isAdmin model = model.admin.isAdmin == Just true

nav :: Model -> Html Message
nav model =
  UI.navBar brand
    ( [ item [ link Home [ HE.text "Home" ] ]
      , item [ link Settings [ HE.text "Settings" ] ]
      ] <> adminSection <> authSection
    )
  where
  -- 管理者は nav の項目 (管理・ベル) が増えるので、狭い画面では項目の左右の余白を詰めて 1 行に収める
  item =
    if isAdmin model then HE.li [ HA.class' "max-sm:[&>a]:px-1.5 max-sm:[&>button]:px-1.5 [&>a]:whitespace-nowrap" ]
    else HE.li_

  -- 管理者にだけ「管理」とベルを出す (非管理者には導線を出さない)
  adminSection =
    if isAdmin model then
      [ item [ link AdminRegistration [ HE.text "管理" ] ]
      , Admin.bellItem model.admin
      ]
    else []

  authSection = case model.session of
    Just session ->
      [ (if isAdmin model then HE.li [ HA.class' "hidden sm:list-item" ] else HE.li_) [ HE.span [ HA.class' ("px-3 py-2 text-sm " <> T.textMuted) ] [ HE.text session.username ] ]
      , item
          [ HE.button
              [ HA.class' T.navLink
              , HA.onClick Logout
              ]
              [ HE.text "Logout" ]
          ]
      ]
    Nothing ->
      [ item [ link Login [ HE.text "Login" ] ] ]

brand :: Html Message
brand =
  HE.span [ HA.class' ("text-lg font-bold tracking-tight " <> T.textHeading) ] [ HE.text "Ratcap" ]
