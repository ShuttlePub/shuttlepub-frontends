module App.View.Drive where

import Prelude

import App.Format (humanize)
import App.Message (Message(..))
import App.Model (FileItem(..), Folder(..), Model, RemoteData(..))
import App.Route (Route(..))
import App.View.Common (emptySlot, errorBanner, icon, routeLink)
import Data.Array (filter, find, length, null, sortBy)
import Data.Maybe (Maybe(..), isJust, maybe)
import Data.String (Pattern(..), contains, joinWith, take, toLower)
import Data.String.Common (trim)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE

view :: Model -> Html Message
view model = HE.div [ HA.key "drive", HA.class' "drive-page", HA.createAttribute "data-testid" "drive-page" ]
  [ HE.div [ HA.class' "drive-heading" ]
      [ HE.div_
          [ HE.p [ HA.class' "eyebrow" ] [ HE.text "YOUR WORKSPACE" ]
          , HE.h1_ [ HE.text (currentFolderName model) ]
          ]
      , HE.button
          [ HA.class' "drive-button primary"
          , HA.onClick ToggleNewMenu
          , HA.disabled (not (folderReady model) || model.busy)
          , HA.createAttribute "data-testid" "new-menu-button"
          , HA.createAttribute "aria-expanded" (if model.newMenuOpen then "true" else "false")
          , HA.createAttribute "aria-controls" "drive-add-menu"
          ]
          [ icon "plus", HE.text "新規" ]
      ]
  , breadcrumbs model
  , errorBanner model.errorMessage
  , HE.input
      [ HA.type' "file"
      , HA.multiple true
      , HA.hidden true
      , HA.onChange StartUpload
      , HA.createAttribute "data-testid" "upload-input"
      , HA.createAttribute "data-folder-id" (maybe "" identity model.selectedFolder)
      , HA.createAttribute "data-folder-name" (currentFolderPath model)
      ]
  , HE.div
      ( [ HA.class' "drive-dropzone"
        , HA.createAttribute "data-testid" "drive-dropzone"
        , HA.createAttribute "data-folder-id" (maybe "" identity model.selectedFolder)
        , HA.createAttribute "data-folder-name" (currentFolderPath model)
        ] <> if folderReady model then [ HA.createAttribute "data-upload-dropzone" "true" ] else []
      )
      [ if model.newMenuOpen then newMenu model else HE.p [ HA.class' "drive-drop-hint" ] [ icon "upload", HE.text "ファイルをここにドラッグしてアップロード" ]
      , if model.folderFormOpen then folderForm model else emptySlot
      , toolbar model
      , HE.div [ HA.class' "drive-browser", HA.createAttribute "data-testid" "drive-browser" ] [ browserContents model ]
      , HE.div [ HA.class' "drop-overlay", HA.createAttribute "aria-hidden" "true" ]
          [ HE.div [ HA.class' "drop-overlay-content" ]
              [ icon "upload", HE.strong_ [ HE.text (currentFolderName model <> " にアップロード") ] ]
          ]
      ]
  ]

newMenu :: Model -> Html Message
newMenu model = HE.div [ HA.id "drive-add-menu", HA.class' "drive-add-menu", HA.createAttribute "data-testid" "new-menu" ]
  [ HE.div [ HA.class' "drive-add-heading" ]
      [ HE.h2_ [ HE.text "この場所に追加" ]
      , HE.button [ HA.class' "icon-button", HA.onClick ToggleNewMenu, HA.createAttribute "aria-label" "追加メニューを閉じる" ] [ icon "close" ]
      ]
  , HE.p [ HA.class' "drive-add-destination" ] [ HE.text ("保存先: " <> currentFolderPath model) ]
  , HE.div [ HA.class' "drive-add-actions" ]
      [ HE.button [ HA.class' "drive-button", HA.onClick ChooseUpload, HA.disabled (not (folderReady model)), HA.createAttribute "data-testid" "upload-submit" ]
          [ icon "upload", HE.text "ファイルをアップロード" ]
      , HE.button [ HA.class' "drive-button", HA.onClick OpenCreateFolder, HA.disabled (not (folderReady model) || model.busy), HA.createAttribute "data-testid" "new-folder-button" ]
          [ icon "folder-add", HE.text "新しいフォルダ" ]
      ]
  ]

toolbar :: Model -> Html Message
toolbar model = HE.div [ HA.class' "drive-toolbar" ]
  [ HE.label [ HA.class' "drive-search" ]
      [ icon "search"
      , HE.input
          [ HA.type' "search"
          , HA.placeholder "このフォルダ内を検索"
          , HA.value model.search
          , HA.onInput SearchChanged
          , HA.createAttribute "aria-label" "このフォルダ内を検索"
          , HA.createAttribute "data-testid" "drive-search"
          ]
      ]
  , HE.div [ HA.class' "drive-display-tools" ]
      [ HE.label [ HA.class' "drive-sort" ]
          [ HE.span [ HA.class' "sr-only" ] [ HE.text "並び順" ]
          , HE.select [ HA.value model.sort, HA.onInput SortChanged, HA.createAttribute "aria-label" "並び順" ]
              [ HE.option [ HA.value "name" ] [ HE.text "名前順" ]
              , HE.option [ HA.value "newest" ] [ HE.text "追加日時順" ]
              , HE.option [ HA.value "size" ] [ HE.text "サイズ順" ]
              ]
          ]
      , HE.div [ HA.class' "view-switch", HA.createAttribute "role" "group", HA.createAttribute "aria-label" "表示形式" ]
          [ viewButton model "list" "リスト表示", viewButton model "grid" "アイコン表示" ]
      ]
  ]

folderReady :: Model -> Boolean
folderReady model = case model.folders of
  Loaded folders -> maybe true (\id -> isJust (find (\(Folder f) -> f.id == id) folders)) model.selectedFolder
  _ -> false

currentFolderName :: Model -> String
currentFolderName model = case model.selectedFolder of
  Nothing -> "マイドライブ"
  Just id -> case model.folders of
    Loaded folders -> maybe "フォルダが見つかりません" (\(Folder f) -> f.name) (find (\(Folder f) -> f.id == id) folders)
    _ -> "フォルダ"

currentFolderPath :: Model -> String
currentFolderPath model = joinWith " / "
  ( [ "マイドライブ" ] <> case model.folders of
      Loaded folders -> map (\(Folder f) -> f.name) (folderAncestors folders model.selectedFolder)
      _ -> []
  )

-- Limit traversal to the available folder count, even if malformed API data
-- contains a cycle; valid trees always reach root earlier.
folderAncestors :: Array Folder -> Maybe String -> Array Folder
folderAncestors folders start = walk (length folders) start
  where
  walk remaining selected
    | remaining <= 0 = []
    | otherwise = case selected >>= \id -> find (\(Folder f) -> f.id == id) folders of
        Nothing -> []
        Just folder@(Folder f) -> walk (remaining - 1) f.parentId <> [ folder ]

breadcrumbs :: Model -> Html Message
breadcrumbs model = HE.nav [ HA.class' "breadcrumbs", HA.createAttribute "aria-label" "パンくず", HA.createAttribute "data-testid" "breadcrumbs" ]
  ( [ routeLink "breadcrumb-root" Drive [ HE.text "マイドライブ" ] ] <> case model.folders of
      Loaded folders -> map
        ( \(Folder f) -> HE.span [ HA.class' "breadcrumb-part" ]
            [ icon "chevron", routeLink "" (FolderDetail f.id) [ HE.text f.name ] ]
        )
        (folderAncestors folders model.selectedFolder)
      _ -> []
  )

viewButton :: Model -> String -> String -> Html Message
viewButton model mode label = HE.button
  [ HA.class' ("icon-button" <> if model.viewMode == mode then " selected" else "")
  , HA.onClick (SetViewMode mode)
  , HA.title label
  , HA.createAttribute "aria-label" label
  , HA.createAttribute "aria-pressed" (if model.viewMode == mode then "true" else "false")
  , HA.createAttribute "data-testid" ("view-" <> mode)
  ]
  [ icon mode ]

folderForm :: Model -> Html Message
folderForm model = HE.form
  [ HA.class' "folder-form"
  , HA.onSubmit (if isJust model.folderForm.editing then SubmitRenameFolder else SubmitCreateFolder)
  , HA.createAttribute "aria-label" (if isJust model.folderForm.editing then "フォルダ名の変更" else "フォルダの作成")
  ]
  [ HE.label [ HA.for "folder-name" ] [ HE.text (if isJust model.folderForm.editing then "フォルダ名の変更" else "新しいフォルダ") ]
  , HE.input
      [ HA.id "folder-name"
      , HA.type' "text"
      , HA.required true
      , HA.autofocus true
      , HA.value model.folderForm.name
      , HA.onInput FolderNameChanged
      , HA.placeholder "フォルダ名"
      , HA.maxlength 255
      , HA.createAttribute "data-testid" (maybe "folder-name-input" ("folder-rename-input-" <> _) model.folderForm.editing)
      ]
  , HE.button
      [ HA.type' "submit"
      , HA.class' "drive-button primary"
      , HA.disabled (model.busy || trim model.folderForm.name == "")
      , HA.createAttribute "data-testid" (maybe "folder-create-submit" ("folder-rename-save-" <> _) model.folderForm.editing)
      ]
      [ HE.text (if model.busy then "保存中…" else if isJust model.folderForm.editing then "保存" else "作成") ]
  , HE.button [ HA.type' "button", HA.class' "drive-button secondary", HA.onClick CloseFolderForm, HA.disabled model.busy ] [ HE.text "キャンセル" ]
  ]

visibleFolders :: Model -> Array Folder -> Array Folder
visibleFolders model = sortBy order <<< filter (\(Folder f) -> f.parentId == model.selectedFolder && matches model.search f.name)
  where
  order (Folder a) (Folder b) = if model.sort == "newest" then compare b.createdAt a.createdAt else compare (toLower a.name) (toLower b.name)

visibleFiles :: Model -> Array FileItem -> Array FileItem
visibleFiles model = sortBy order <<< filter (\(FileItem f) -> f.folderId == model.selectedFolder && matches model.search f.name)
  where
  order (FileItem a) (FileItem b) = case model.sort of
    "newest" -> compare b.createdAt a.createdAt
    "size" -> compare b.sizeBytes a.sizeBytes
    _ -> compare (toLower a.name) (toLower b.name)

matches :: String -> String -> Boolean
matches search name = contains (Pattern (toLower (trim search))) (toLower name)

browserContents :: Model -> Html Message
browserContents model = case model.folders, model.files of
  Failed err, _ -> failure err
  _, Failed err -> failure err
  Loaded folders, Loaded files ->
    if not (folderReady model) then stateView "フォルダが見つかりません" "削除されたか、アクセスできないフォルダです。"
    else
      let
        fs = visibleFolders model folders
        items = visibleFiles model files
      in
        HE.div_
          [ if model.viewMode == "grid" then grid fs items else list fs items
          , if null fs && null items then
              if trim model.search /= "" then stateView "一致する項目がありません" "検索語を変えるか、検索欄を空にしてください。"
              else stateView "このフォルダは空です" "ファイルをアップロードするか、新しいフォルダを作成できます。"
            else emptySlot
          , HE.div [ HA.class' "drive-item-count" ] [ HE.text (show (length fs + length items) <> " 項目") ]
          ]
  _, _ -> HE.div [ HA.class' "drive-state", HA.createAttribute "role" "status", HA.createAttribute "data-testid" "drive-loading" ]
    [ HE.div [ HA.class' "loading-spinner" ] [], HE.p_ [ HE.text "読み込み中…" ] ]
  where
  failure err = HE.div [ HA.class' "drive-state", HA.createAttribute "role" "alert" ]
    [ HE.h2_ [ HE.text "読み込めませんでした" ]
    , HE.p_ [ HE.text err ]
    , HE.button [ HA.class' "drive-button secondary", HA.onClick LoadDrive, HA.disabled model.busy ] [ HE.text "再読み込み" ]
    ]
  list folders files = HE.div [ HA.class' "drive-table-scroll" ]
    [ HE.table [ HA.class' "drive-table", HA.createAttribute "aria-label" "フォルダとファイル" ]
        [ HE.thead_
            [ HE.tr_
                [ HE.th [ HA.scope "col" ] [ HE.text "名前" ]
                , HE.th [ HA.scope "col" ] [ HE.text "サイズ" ]
                , HE.th [ HA.scope "col", HA.class' "date-column" ] [ HE.text "追加日時" ]
                , HE.th [ HA.scope "col" ] [ HE.span [ HA.class' "sr-only" ] [ HE.text "操作" ] ]
                ]
            ]
        , HE.tbody [ HA.createAttribute "data-testid" "folder-list" ] (map folderRow folders)
        , HE.tbody [ HA.createAttribute "data-testid" "file-list" ] (map fileRow files)
        ]
    ]
  grid folders files = HE.div [ HA.class' "drive-grid", HA.createAttribute "data-testid" "icon-grid" ]
    [ HE.div [ HA.class' "grid-group", HA.createAttribute "data-testid" "folder-list" ] (map folderTile folders)
    , HE.div [ HA.class' "grid-group", HA.createAttribute "data-testid" "file-list" ] (map fileTile files)
    ]

stateView :: String -> String -> Html Message
stateView title description = HE.div [ HA.class' "drive-state", HA.createAttribute "data-testid" "drive-empty" ]
  [ icon "folder", HE.h2_ [ HE.text title ], HE.p_ [ HE.text description ] ]

folderRow :: Folder -> Html Message
folderRow (Folder folder) = HE.tr [ HA.key folder.id, HA.createAttribute "data-folder-row" folder.id ]
  [ HE.td_ [ routeLink "item-name" (FolderDetail folder.id) [ icon "folder", HE.span_ [ HE.text folder.name ] ] ]
  , HE.td [ HA.class' "muted" ] [ HE.text "—" ]
  , HE.td [ HA.class' "muted date-column" ] [ HE.text (take 10 folder.createdAt) ]
  , HE.td [ HA.class' "row-actions" ]
      [ HE.button
          [ HA.onClick (StartRenameFolder folder.id)
          , HA.class' "text-button"
          , HA.createAttribute "data-testid" ("rename-folder-" <> folder.id)
          , HA.createAttribute "aria-label" (folder.name <> " の名前を変更")
          ]
          [ HE.text "名前変更" ]
      , HE.button
          [ HA.onClick (SubmitDeleteFolder folder.id)
          , HA.class' "text-button danger"
          , HA.createAttribute "data-testid" ("delete-folder-" <> folder.id)
          , HA.createAttribute "aria-label" (folder.name <> " を削除")
          ]
          [ HE.text "削除" ]
      ]
  ]

fileRow :: FileItem -> Html Message
fileRow (FileItem file) = HE.tr [ HA.key file.id ]
  [ HE.td_ [ routeLink "item-name" (FileDetail file.id) [ fileIcon file.mimeType, HE.span_ [ HE.text file.name ] ] ]
  , HE.td [ HA.class' "muted" ] [ HE.text (humanize file.sizeBytes) ]
  , HE.td [ HA.class' "muted date-column" ] [ HE.text (take 10 file.createdAt) ]
  , HE.td [ HA.class' "row-actions" ]
      [ HE.a
          [ HA.href ("/api/files/" <> file.id <> "/download")
          , HA.target "_blank"
          , HA.rel "noopener"
          , HA.onClick (DownloadRequested file.id file.name)
          , HA.class' "icon-button"
          , HA.title "ダウンロード"
          , HA.createAttribute "aria-label" (file.name <> " をダウンロード")
          , HA.createAttribute "data-testid" ("download-file-" <> file.name)
          ]
          [ icon "download" ]
      , HE.button
          [ HA.onClick (SubmitDeleteFile file.id)
          , HA.class' "text-button danger"
          , HA.createAttribute "data-testid" ("delete-file-" <> file.name)
          , HA.createAttribute "aria-label" (file.name <> " を削除")
          ]
          [ HE.text "削除" ]
      ]
  ]

folderTile :: Folder -> Html Message
folderTile (Folder folder) = routeLink "drive-tile" (FolderDetail folder.id) [ icon "folder", HE.span_ [ HE.text folder.name ] ]

fileTile :: FileItem -> Html Message
fileTile (FileItem file) = routeLink "drive-tile" (FileDetail file.id) [ fileIcon file.mimeType, HE.span_ [ HE.text file.name ] ]

fileIcon :: String -> Html Message
fileIcon mime = icon (if take 6 mime == "image/" then "image" else "file")
