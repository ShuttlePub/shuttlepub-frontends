module App.View.FileDetail where

import Prelude

import App.Format (humanize)
import App.Message (Message(..))
import App.Route (Route(..))
import App.Model (FileItem(..), Model, RemoteData(..))
import Data.Array (find)
import Data.Maybe (Maybe(..), fromMaybe)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Theme as T
import ShuttlePub.UI.Link (navLink)

view :: String -> Model -> Html Message
view fileId model =
  HE.div
    [ HA.key "file-detail", HA.class' "space-y-8", HA.createAttribute "data-testid" "file-detail-page" ]
    [ navLink "/drive" (Navigate Drive) [ HE.text "Drive に戻る" ]
    , HE.h1 [ HA.class' ("text-4xl font-bold tracking-tight " <> T.textHeading) ] [ HE.text "ファイル詳細" ]
    , HE.div [ HA.class' ("p-6 space-y-4 break-words " <> T.surface) ]
        [ case model.files of
            NotAsked -> HE.p_ [ HE.text "読み込み待ち" ]
            Loading -> HE.p_ [ HE.text "読み込み中…" ]
            Failed message -> HE.p [ HA.class' T.textError, HA.createAttribute "role" "alert" ] [ HE.text message ]
            Loaded files -> case find (\(FileItem file) -> file.id == fileId) files of
              Nothing -> HE.p_ [ HE.text "ファイルが見つかりません" ]
              Just (FileItem file) ->
                HE.div [ HA.class' "space-y-4" ]
                  [ HE.h2 [ HA.class' ("text-lg font-semibold " <> T.textHeading) ] [ HE.text file.name ]
                  , HE.dl [ HA.class' "space-y-3 text-sm" ]
                      ( map
                          ( \field -> HE.div_
                              [ HE.dt [ HA.class' T.textSecondary ] [ HE.text field.label ]
                              , HE.dd [ HA.class' T.textPrimary ] [ HE.text field.value ]
                              ]
                          )
                          [ { label: "ID", value: file.id }
                          , { label: "種類", value: file.mimeType }
                          , { label: "サイズ", value: humanize file.sizeBytes }
                          , { label: "作成日時", value: file.createdAt }
                          , { label: "フォルダ ID", value: fromMaybe "ルート" file.folderId }
                          , { label: "公開範囲", value: if file.isPublic then "公開" else "非公開" }
                          ]
                      )
                  , HE.a
                      [ HA.href ("/api/files/" <> file.id <> "/download"), HA.class' T.navLink ]
                      [ HE.text "ダウンロード" ]
                  ]
        ]
    ]
