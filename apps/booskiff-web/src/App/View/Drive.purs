module App.View.Drive where

import Prelude

import App.Format (humanize)
import App.Message (Message(..))
import App.Route (Route(..), routeCodec)
import App.Model (Billing(..), FileItem(..), Folder(..), Model, RemoteData(..), UploadState)
import Data.Int (floor)
import Data.Maybe (Maybe(..), isJust, maybe)
import Data.String as S
import Data.String.Common (trim)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Theme as T
import Routing.Duplex (print)

view :: Model -> Html Message
view model =
  HE.div
    [ HA.key "drive"
    , HA.class' "space-y-8"
    , HA.createAttribute "data-testid" "drive-page"
    ]
    [ HE.h1
        [ HA.class' ("text-4xl font-bold tracking-tight " <> T.textHeading) ]
        [ HE.text "Drive" ]
    , errorBanner model.errorMessage
    , quotaView model.billing
    , uploadSection model
    , folderSection model
    , fileSection model
    ]

errorBanner :: Maybe String -> Html Message
errorBanner = case _ of
  Nothing -> HE.text ""
  Just msg ->
    HE.div
      [ HA.class'
          ( "px-4 py-3 text-sm " <> T.roundedTheme <> " " <> T.textError <> " border "
              <> T.borderTheme
              <> " bg-red-500/10"
          )
      ]
      [ HE.text msg ]

quotaView :: RemoteData Billing -> Html Message
quotaView = case _ of
  Loaded (Billing b) ->
    HE.div
      [ HA.class' ("text-sm " <> T.textSecondary)
      , HA.createAttribute "data-testid" "quota"
      ]
      [ HE.text
          ( humanize b.usedBytes
              <> " / "
              <> humanize b.storageQuotaBytes
              <> " · max "
              <> humanize b.maxFileBytes
              <> "/file"
          )
      ]
  _ ->
    HE.div
      [ HA.class' ("text-sm " <> T.textSecondary)
      , HA.createAttribute "data-testid" "quota"
      ]
      [ HE.text "-- / --" ]

uploadSection :: Model -> Html Message
uploadSection model =
  HE.div [ HA.class' ("p-6 space-y-4 " <> T.surface) ]
    [ HE.h2
        [ HA.class' ("text-lg font-semibold " <> T.textHeading) ]
        [ HE.text "アップロード" ]
    , HE.div [ HA.class' "flex items-center gap-3" ]
        [ HE.input
            [ HA.type' "file"
            , HA.class' ("block w-full text-sm " <> T.textPrimary)
            , HA.createAttribute "data-testid" "upload-input"
            , HA.createAttribute "data-folder-id" (maybe "" identity model.selectedFolder)
            ]
        , HE.button
            [ HA.class'
                ( "px-4 py-2 text-sm font-medium text-white " <> T.bgAccent <> " "
                    <> T.hoverBgAccent
                    <> " "
                    <> T.roundedTheme
                    <> if model.busy || isJust model.upload then " opacity-50 cursor-not-allowed" else ""
                )
            , HA.onClick StartUpload
            , HA.disabled (model.busy || isJust model.upload)
            , HA.createAttribute "data-testid" "upload-submit"
            ]
            [ HE.text "アップロード" ]
        ]
    , maybe (HE.text "") progressView model.upload
    , maybe (HE.text "") uploadErrorView (uploadErrorFor model)
    ]

uploadErrorFor :: Model -> Maybe String
uploadErrorFor model = model.errorMessage

progressView :: UploadState -> Html Message
progressView upload =
  let
    percent =
      if upload.total > 0.0 then floor (upload.loaded * 100.0 / upload.total)
      else 0
  in
    HE.div
      [ HA.class' "w-full"
      , HA.createAttribute "data-testid" "upload-progress"
      ]
      [ HE.div [ HA.class' "flex justify-between text-xs mb-1" ]
          [ HE.span [ HA.class' T.textSecondary ] [ HE.text upload.name ]
          , HE.span [ HA.class' T.textSecondary ] [ HE.text (show percent <> "%") ]
          ]
      , HE.div
          [ HA.class' ("w-full h-2 overflow-hidden rounded-theme " <> T.bgSecondary) ]
          [ HE.div
              [ HA.class' ("h-full transition-all " <> T.bgAccent)
              , HA.style { width: show percent <> "%" }
              ]
              []
          ]
      ]

uploadErrorView :: String -> Html Message
uploadErrorView msg =
  HE.div
    [ HA.class'
        ( "px-4 py-3 text-sm " <> T.roundedTheme <> " " <> T.textError <> " border "
            <> T.borderTheme
            <> " bg-red-500/10"
        )
    , HA.createAttribute "data-testid" "file-upload-error"
    ]
    [ HE.text msg ]

folderSection :: Model -> Html Message
folderSection model =
  HE.div [ HA.class' ("p-6 space-y-4 " <> T.surface) ]
    [ HE.div [ HA.class' "flex items-center justify-between" ]
        [ HE.h2
            [ HA.class' ("text-lg font-semibold " <> T.textHeading) ]
            [ HE.text "フォルダ" ]
        , allButton model.selectedFolder
        ]
    , createFolderForm model
    , HE.ul
        [ HA.class' "space-y-2"
        , HA.createAttribute "data-testid" "folder-list"
        ]
        ( case folders of
            [] -> [ HE.li [ HA.class' ("text-sm " <> T.textSecondary) ] [ HE.text "フォルダはまだありません" ] ]
            _ -> map (folderRow model) folders
        )
    ]
  where
  folders = case model.folders of
    Loaded fs -> fs
    _ -> []

allButton :: Maybe String -> Html Message
allButton = case _ of
  Nothing -> HE.text ""
  Just _ ->
    HE.button
      [ HA.class' ("text-sm " <> T.navLink)
      , HA.onClick (SelectFolder Nothing)
      ]
      [ HE.text "すべて" ]

createFolderForm :: Model -> Html Message
createFolderForm model =
  HE.div [ HA.class' "flex items-center gap-3" ]
    [ HE.input
        [ HA.class' (inputClass <> " flex-1")
        , HA.type' "text"
        , HA.placeholder "新しいフォルダ名"
        , HA.value model.folderForm.name
        , HA.onInput FolderNameChanged
        , HA.createAttribute "data-testid" "folder-name-input"
        ]
    , HE.button
        [ HA.class'
            ( "px-4 py-2 text-sm font-medium text-white " <> T.bgAccent <> " "
                <> T.hoverBgAccent
                <> " "
                <> T.roundedTheme
                <> if disabled then " opacity-50 cursor-not-allowed" else ""
            )
        , HA.onClick SubmitCreateFolder
        , HA.disabled disabled
        , HA.createAttribute "data-testid" "folder-create-submit"
        ]
        [ HE.text "作成" ]
    ]
  where
  disabled = model.busy || isJust model.folderForm.editing || trim model.folderForm.name == ""

folderRow :: Model -> Folder -> Html Message
folderRow model (Folder folder) =
  if model.folderForm.editing == Just folder.id then
    HE.li
      [ HA.class'
          ( "flex items-center gap-3 p-3 rounded-theme border " <> T.borderTheme <> " "
              <> T.bgSecondary
          )
      ]
      [ HE.input
          [ HA.class' (inputClass <> " flex-1")
          , HA.type' "text"
          , HA.value model.folderForm.name
          , HA.onInput FolderNameChanged
            , HA.createAttribute "data-testid" ("folder-rename-input-" <> folder.name)
          ]
      , HE.button
          [ HA.class'
              ( "px-3 py-1.5 text-sm text-white " <> T.bgAccent <> " " <> T.roundedTheme
              )
          , HA.onClick SubmitRenameFolder
          , HA.createAttribute "data-testid" ("folder-rename-save-" <> folder.name)
          ]
          [ HE.text "保存" ]
      ]
  else
    HE.li
      [ HA.class'
          ( "flex items-center justify-between p-3 rounded-theme border " <> T.borderTheme
              <> " "
              <> T.bgSecondary
          )
      ]
      [ HE.button
          [ HA.class' ("text-sm font-medium " <> T.textPrimary <> " hover:text-accent")
          , HA.onClick (SelectFolder (Just folder.id))
          ]
          [ HE.text folder.name ]
      , HE.div [ HA.class' "flex items-center gap-2" ]
          [ HE.button
              [ HA.class' ("px-2 py-1 text-xs " <> T.navLink)
              , HA.onClick (StartRenameFolder folder.id)
              , HA.createAttribute "data-testid" ("rename-folder-" <> folder.id)
              ]
              [ HE.text "rename" ]
          , HE.button
              [ HA.class' ("px-2 py-1 text-xs " <> T.navLink)
              , HA.onClick (SubmitDeleteFolder folder.id)
              , HA.createAttribute "data-testid" ("delete-folder-" <> folder.id)
              ]
              [ HE.text "delete" ]
          ]
      ]

fileSection :: Model -> Html Message
fileSection model =
  HE.div [ HA.class' ("p-6 space-y-4 " <> T.surface) ]
    [ HE.h2
        [ HA.class' ("text-lg font-semibold " <> T.textHeading) ]
        [ HE.text "ファイル" ]
    , HE.ul
        [ HA.class' "space-y-2"
        , HA.createAttribute "data-testid" "file-list"
        ]
        ( case files of
            [] -> [ HE.li [ HA.class' ("text-sm " <> T.textSecondary) ] [ HE.text "ファイルはまだありません" ] ]
            _ -> map fileRow files
        )
    ]
  where
  files = case model.files of
    Loaded fs -> fs
    _ -> []

fileRow :: FileItem -> Html Message
fileRow (FileItem file) =
  HE.li
    [ HA.class'
        ( "flex items-center justify-between p-3 rounded-theme border " <> T.borderTheme
            <> " "
            <> T.bgSecondary
        )
    ]
    [ HE.div [ HA.class' "flex items-center gap-3 min-w-0" ]
        [ HE.a
            [ HA.class' ("text-sm font-medium truncate " <> T.navLink)
            , HA.href (print routeCodec (FileDetail file.id))
            ]
            [ HE.text file.name ]
        , HE.span
            [ HA.class' ("text-xs " <> T.textMuted) ]
            [ HE.text (humanize file.sizeBytes) ]
        , HE.span
            [ HA.class' ("text-xs " <> T.textMuted) ]
            [ HE.text (S.take 10 file.createdAt) ]
        ]
    , HE.div [ HA.class' "flex items-center gap-2 shrink-0" ]
        [ HE.a
            [ HA.href ("/api/files/" <> file.id <> "/download")
            , HA.class' ("px-2 py-1 text-xs " <> T.navLink)
            , HA.createAttribute "data-testid" ("download-file-" <> file.name)
            ]
            [ HE.text "download" ]
        , HE.button
            [ HA.class' ("px-2 py-1 text-xs " <> T.navLink)
            , HA.onClick (SubmitDeleteFile file.id)
            , HA.createAttribute "data-testid" ("delete-file-" <> file.name)
            ]
            [ HE.text "delete" ]
        ]
    ]

inputClass :: String
inputClass =
  "px-3 py-2 text-sm border " <> T.borderTheme <> " " <> T.bgSurface <> " "
    <> T.textPrimary
    <> " "
    <> T.roundedTheme
    <> " focus:outline-none focus:ring-2 focus:ring-accent/50"
