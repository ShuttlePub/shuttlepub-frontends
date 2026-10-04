module App.View.Transfers where

import Prelude

import App.Message (Message(..))
import App.Model (Model, UploadState)
import App.Route (Route(..))
import App.View.Common (emptySlot, icon, routeLink)
import Data.Array (filter, length, null)
import Data.Int (floor)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

view :: Model -> Html Message
view model
  | null model.uploads && null model.downloads = emptySlot
  | otherwise =
      HE.aside
        [ HA.class' ("transfer-panel" <> if model.transferExpanded then " expanded" else "")
        , HA.createAttribute "aria-label" "転送"
        , HA.createAttribute "data-testid" "transfer-panel"
        ]
        [ HE.button
            [ HA.class' "transfer-heading"
            , HA.onClick ToggleTransfers
            , HA.createAttribute "data-testid" "transfer-toggle"
            , HA.createAttribute "aria-expanded" (if model.transferExpanded then "true" else "false")
            , HA.createAttribute "aria-controls" "transfer-content"
            ]
            [ icon "upload"
            , HE.strong_ [ HE.text summary ]
            , HE.span [ HA.class' "transfer-chevron" ] [ HE.text (if model.transferExpanded then "⌄" else "⌃") ]
            ]
        , HE.div [ HA.class' "transfer-summary sr-only", HA.createAttribute "role" "status" ] [ HE.text summary ]
        , HE.div [ HA.id "transfer-content", HA.hidden (not model.transferExpanded) ]
            [ HE.div [ HA.class' "transfer-items" ]
                (map uploadRow model.uploads <> map downloadRow model.downloads)
            , HE.div [ HA.class' "transfer-footer" ]
                [ HE.span_ [ HE.text "完了・要求済みの履歴" ]
                , HE.button [ HA.class' "text-button", HA.onClick ClearTransfers, HA.createAttribute "data-testid" "clear-transfers" ] [ HE.text "クリア" ]
                ]
            ]
        ]
      where
      active = length (filter (\u -> u.status == "sending" || u.status == "saving") model.uploads)
      queued = length (filter (\u -> u.status == "queued") model.uploads)
      issues = length (filter (\u -> u.status == "failed" || u.status == "uncertain") model.uploads)
      summary =
        if active > 0 || queued > 0 then "進行中 " <> show active <> "・待機 " <> show queued <> (if issues > 0 then "・要確認 " <> show issues else "")
        else if issues > 0 then "転送・要確認 " <> show issues <> " 件"
        else "転送 " <> show (length model.uploads + length model.downloads) <> " 件"
      downloadRow download = HE.div [ HA.class' "transfer-item", HA.key ("download-" <> download.id) ]
        [ HE.div [ HA.class' "transfer-item-title" ] [ icon "download", HE.strong_ [ HE.text download.name ] ]
        , HE.p [ HA.class' "muted" ] [ HE.text "ダウンロードを要求済み" ]
        , HE.p [ HA.class' "transfer-note" ] [ HE.text "進行状況と保存結果はブラウザで確認してください" ]
        ]

uploadRow :: UploadState -> Html Message
uploadRow upload = HE.div [ HA.class' "transfer-item", HA.key upload.id, HA.createAttribute "data-testid" upload.id ]
  [ HE.div [ HA.class' "transfer-item-title" ]
      [ icon (if upload.status == "completed" then "check" else "upload"), HE.strong_ [ HE.text upload.name ] ]
  , HE.div [ HA.class' "transfer-meta" ]
      [ routeLink "transfer-destination" (if upload.destinationId == "" then Drive else FolderDetail upload.destinationId)
          [ HE.text ("保存先: " <> upload.destinationName) ]
      , HE.span [ HA.class' (if upload.status == "completed" then "transfer-success" else "muted") ] [ HE.text (statusLabel upload) ]
      ]
  , if upload.status == "sending" || upload.status == "saving" then
      HE.div
        [ HA.class' "transfer-progress"
        , HA.createAttribute "data-testid" "upload-progress"
        , HA.createAttribute "role" "progressbar"
        , HA.createAttribute "aria-label" (upload.name <> " の送信")
        , HA.createAttribute "aria-valuemin" "0"
        , HA.createAttribute "aria-valuemax" "100"
        , HA.createAttribute "aria-valuenow" (show (percent upload))
        , HA.createAttribute "aria-valuetext" (statusLabel upload)
        ]
        [ HE.div [ HA.style { width: show (percent upload) <> "%" } ] [] ]
    else emptySlot
  , if upload.error /= "" then HE.p [ HA.class' "transfer-error", HA.createAttribute "data-testid" "file-upload-error" ] [ HE.text upload.error ] else emptySlot
  , if upload.retryable then HE.button [ HA.class' "text-button", HA.onClick (RetryUpload upload.id), HA.createAttribute "data-testid" ("retry-" <> upload.id) ] [ HE.text "再試行" ] else emptySlot
  , if upload.status == "failed" || upload.status == "uncertain" then
      HE.button [ HA.class' "text-button", HA.onClick (DismissTransfer upload.id), HA.createAttribute "aria-label" (upload.name <> " を履歴から削除") ] [ HE.text "履歴から削除" ]
    else emptySlot
  ]

percent :: UploadState -> Int
percent upload = if upload.total > 0.0 then min 100 (max 0 (floor (upload.loaded * 100.0 / upload.total))) else 0

statusLabel :: UploadState -> String
statusLabel upload = case upload.status of
  "queued" -> "待機中"
  "sending" -> "送信中 " <> show (percent upload) <> "%"
  "saving" -> "保存中…"
  "completed" -> "完了"
  "failed" -> "失敗"
  "uncertain" -> "結果未確認"
  _ -> "待機中"
