module App.View.Layout where

import Prelude

import App.Format (humanize)
import App.Message (Message(..))
import App.Model (Billing(..), Model, PageModel(..), RemoteData(..))
import App.Route as Route
import App.View.Common (emptySlot, icon, routeLink)
import App.View.Transfers as Transfers
import Data.Array (null)
import Data.Int (floor)
import Data.Maybe (Maybe(..))
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

page :: Model -> Array (Html Message) -> Html Message
page model content = HE.main [ HA.id "app", HA.lang "ja", HA.class' ("booskiff-app" <> if model.transferExpanded && (not (null model.uploads) || not (null model.downloads)) then " has-transfers" else "") ]
  [ HE.header [ HA.class' "app-header" ]
      [ routeLink "app-brand" Route.Drive [ HE.span [ HA.class' "brand-symbol" ] [ icon "folder" ], HE.text "Booskiff" ]
      , HE.div [ HA.class' "app-account" ]
          ( case model.session of
              Just session ->
                [ HE.span [ HA.class' "account-name" ] [ HE.text session.username ]
                , HE.button [ HA.class' "text-button", HA.onClick Logout, HA.createAttribute "data-testid" "logout-button", HA.disabled model.busy ] [ HE.text "Logout" ]
                ]
              Nothing -> [ emptySlot ]
          )
      ]
  , HE.div [ HA.class' (if workspace then "workspace-layout" else "login-layout") ]
      [ if workspace then sidebar model else emptySlot
      , HE.section [ HA.id "content", HA.class' "workspace-content" ] content
      ]
  , Transfers.view model
  ]
  where
  workspace = case model.page of
    Drive -> true
    FileDetail _ -> true
    _ -> false

sidebar :: Model -> Html Message
sidebar model = HE.aside [ HA.class' "drive-sidebar", HA.createAttribute "aria-label" "ドライブナビゲーション" ]
  [ HE.div_
      [ HE.p [ HA.class' "eyebrow" ] [ HE.text "LIBRARY" ]
      , routeLink "sidebar-link selected" Route.Drive [ icon "folder", HE.text "マイドライブ" ]
      ]
  , HE.div [ HA.class' "storage-card", HA.createAttribute "data-testid" "quota" ]
      ( case model.billing of
          Loaded (Billing b) ->
            [ HE.span [ HA.class' "storage-label" ] [ HE.text "ストレージ" ]
            , HE.div [ HA.class' "storage-track" ]
                [ HE.div [ HA.style { width: show (if b.storageQuotaBytes > 0.0 then min 100 (floor (b.usedBytes * 100.0 / b.storageQuotaBytes)) else 0) <> "%" } ] [] ]
            , HE.p_ [ HE.text (humanize b.usedBytes <> " / " <> humanize b.storageQuotaBytes) ]
            , HE.p [ HA.class' "storage-limit" ] [ HE.text ("1 ファイル最大 " <> humanize b.maxFileBytes) ]
            ]
          Failed _ -> [ HE.p [ HA.class' "muted" ] [ HE.text "使用容量を取得できません" ] ]
          _ -> [ HE.p [ HA.class' "muted" ] [ HE.text "ストレージ — / —" ] ]
      )
  ]
