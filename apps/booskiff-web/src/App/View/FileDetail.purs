module App.View.FileDetail where

import Prelude

import App.Format (humanize)
import App.Message (Message(..))
import App.Route (Route(..))
import App.Model (FileItem(..), Model, RemoteData(..))
import App.View.Common (routeLink, icon)
import Data.Array (find)
import Data.Maybe (Maybe(..), maybe)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

view :: String -> Model -> Html Message
view fileId model = HE.div
  [ HA.key "file-detail", HA.class' "file-detail", HA.createAttribute "data-testid" "file-detail-page" ]
  [ case model.detail of
      Loaded files -> case find (\(FileItem f) -> f.id == fileId) files of
        Just (FileItem f) -> routeLink "detail-back" (maybe Drive FolderDetail f.folderId) [ HE.text "← フォルダに戻る" ]
        _ -> routeLink "detail-back" Drive [ HE.text "← マイドライブに戻る" ]
      _ -> routeLink "detail-back" Drive [ HE.text "← マイドライブに戻る" ]
  , case model.detail of
      NotAsked -> HE.p_ [ HE.text "読み込み中…" ]
      Loading -> HE.p [ HA.createAttribute "role" "status" ] [ HE.text "読み込み中…" ]
      Failed message -> HE.p [ HA.class' "drive-error", HA.createAttribute "role" "alert" ] [ HE.text message ]
      Loaded files -> case find (\(FileItem file) -> file.id == fileId) files of
        Nothing -> HE.div [ HA.class' "drive-state" ] [ HE.h1_ [ HE.text "ファイルが見つかりません" ] ]
        Just (FileItem file) -> HE.article [ HA.class' "detail-card" ]
          [ icon "file"
          , HE.h1_ [ HE.text file.name ]
          , HE.dl_
              ( map (\field -> HE.div_ [ HE.dt_ [ HE.text field.label ], HE.dd_ [ HE.text field.value ] ])
                  [ { label: "種類", value: file.mimeType }
                  , { label: "サイズ", value: humanize file.sizeBytes }
                  , { label: "追加日時", value: file.createdAt }
                  , { label: "公開範囲", value: if file.isPublic then "公開" else "非公開" }
                  ]
              )
          , HE.a
              [ HA.href ("/api/files/" <> file.id <> "/download")
              , HA.target "_blank"
              , HA.rel "noopener"
              , HA.class' "drive-button primary"
              , HA.onClick (DownloadRequested file.id file.name)
              ]
              [ icon "download", HE.text "ダウンロード" ]
          ]
  ]
