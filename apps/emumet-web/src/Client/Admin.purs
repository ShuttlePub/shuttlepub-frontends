-- | 登録ゲート管理 (管理者のみ) の update。認可の正本は BFF/Emumet で、ここは導線と表示の状態だけを持つ。
module Client.Admin
  ( updateAdmin
  , fetchViewerAff
  , enterRoute
  ) where

import Prelude

import App.Admin.Text as Text
import App.Admin.Time (focusById)
import App.Admin.Types (AdminModal(..), AdminModel, AdminMsg(..), Failure, Gate, GateCommand(..), GateError(..), Loadable(..), acceptGate, allCategories, categoriesChanged, emptyAdminModel, emptyWebhookForm, webhookFormSavable)
import App.Api.RegistrationGate as Api
import App.Message (Message(..))
import App.Model (Model)
import App.Route (Route, isAdminRoute)
import Data.Array (cons, delete, elem, filter, find)
import Data.Either (Either(..))
import Data.Maybe (Maybe(..), maybe)
import Data.Time.Duration (Milliseconds(..))
import Data.Tuple (Tuple(..))
import Effect.Aff (Aff, delay)
import Effect.Class (liftEffect)

type Effects = Array (Aff (Maybe Message))

-- | 未認証は既存の SessionExpired (再ログイン) に流し、それ以外は管理画面のエラーとして扱う
deliver :: forall a. Aff (Either GateError a) -> (a -> AdminMsg) -> (GateError -> AdminMsg) -> Aff (Maybe Message)
deliver call ok ng = do
  result <- call
  pure $ Just $ case result of
    Left err -> failure ng err
    Right value -> Admin (ok value)

-- | 未認証は再ログイン、権限なしは管理画面の失効 (共通処理)、それ以外は呼び出し元のエラー表示
failure :: (GateError -> AdminMsg) -> GateError -> Message
failure ng = case _ of
  Unauthenticated -> SessionExpired
  Forbidden -> Admin AdminForbidden
  err -> Admin (ng err)

fetchViewerAff :: Aff (Maybe Message)
fetchViewerAff = do
  result <- Api.fetchViewerIsAdmin
  pure $ Just $ case result of
    -- 401/403 は認可の結果、それ以外 (一時障害・通信失敗・契約違反) は「分からない」として扱い、混同しない
    Left Unauthenticated -> SessionExpired
    Left Forbidden -> Admin AdminForbidden
    Left _ -> Admin ViewerUnavailable
    Right isAdmin -> Admin (ViewerLoaded isAdmin)

fetchGateAff :: Aff (Maybe Message)
fetchGateAff = deliver Api.fetchGate GateLoaded GateLoadFailed

fetchProtectionsAff :: Aff (Maybe Message)
fetchProtectionsAff = deliver Api.fetchProtections ProtectionsLoaded ProtectionsLoadFailed

fetchWebhookAff :: Aff (Maybe Message)
fetchWebhookAff = deliver Api.fetchWebhook WebhookLoaded WebhookLoadFailed

fetchFailuresAff :: Aff (Maybe Message)
fetchFailuresAff = deliver (Api.fetchFailures Nothing) FailuresLoaded FailuresFailed

failureKey :: Failure -> { endpointId :: String, eventId :: String }
failureKey f = { endpointId: f.endpointId, eventId: f.eventId }

-- | 送信先のモーダルを閉じる。入力 (シークレットを含む) はモデルに残さない
closedWebhookModal :: AdminModel -> AdminModel
closedWebhookModal admin = admin { modal = Nothing, modalOrigin = Nothing, webhookForm = emptyWebhookForm }

fetchNotificationsAff :: Aff (Maybe Message)
fetchNotificationsAff = deliver (Api.fetchNotifications Nothing) NotificationsLoaded NotificationsFailed

refreshEffects :: Effects
refreshEffects = [ fetchGateAff, fetchProtectionsAff, fetchWebhookAff, fetchFailuresAff, fetchNotificationsAff ]

-- | 管理画面の Route に入ったとき (管理者と分かっている場合だけ取得する)
enterRoute :: Maybe Route -> Model -> Effects
enterRoute route model = case route of
  Just r | isAdminRoute r && model.admin.isAdmin == Just true -> refreshEffects
  _ -> []

setAdmin :: Model -> AdminModel -> Model
setAdmin model admin = model { admin = admin }

-- | 取得に失敗しても、取得済みの値は消さない (強制開放中の警告帯を画面遷移・再取得で消さない)
keepLoaded :: forall a. Loadable a -> GateError -> Loadable a
keepLoaded current err = case current of
  Loaded value -> Loaded value
  _ -> LoadFailed err

withGate :: Model -> (Gate -> Tuple Model Effects) -> Tuple Model Effects
withGate model f = case model.admin.gate of
  Loaded gate | not model.admin.pending -> f gate
  _ -> Tuple model []

showToast :: String -> AdminModel -> Tuple AdminModel Effects
showToast text admin =
  let
    id = admin.toastSeq + 1
  in
    Tuple (admin { toast = Just { id, text }, toastSeq = id })
      [ delay (Milliseconds 2200.0) $> Just (Admin (DismissToast id)) ]

focusLater :: String -> Aff (Maybe Message)
focusLater id = do
  delay (Milliseconds 0.0)
  liftEffect (focusById id)
  pure Nothing

commandToast :: GateCommand -> Maybe String
commandToast = case _ of
  OpenGate -> Just Text.toastOpened
  CloseGate -> Just Text.toastStopped
  RevokeOverride -> Just Text.toastOverrideRevoked
  EnableOverride -> Nothing

-- | 失敗後に最新の状態を取り直すべきか (競合・前提条件は状態が変わっている)
refetchOnError :: GateError -> Boolean
refetchOnError = case _ of
  RevisionConflict -> true
  PreconditionFailed -> true
  NotFound -> true
  WebhookNotConfigured -> true
  _ -> false

updateAdmin :: Model -> AdminMsg -> Tuple Model Effects
updateAdmin model msg =
  let
    admin = model.admin
    noFx m = Tuple m []
  in
    case msg of
      ViewerLoaded isAdmin ->
        let
          -- 管理 API が FORBIDDEN を返した後は、viewer のヒントが管理者でも管理画面を出さない
          granted = isAdmin && not admin.forbidden
          m = setAdmin model (admin { isAdmin = Just granted })
        in
          if granted then Tuple m ([ fetchNotificationsAff ] <> enterRouteEffects m)
          else noFx m

      ViewerUnavailable ->
        case admin.isAdmin of
          -- SSR や前回の取得で管理者と分かっている: 警告帯・状態を保ったまま、管理画面の状態だけ取り直す
          Just true -> Tuple model ([ fetchNotificationsAff ] <> enterRouteEffects model)
          Just false -> noFx model
          -- まだ何も分からない: 導線は出さない (fail closed)
          Nothing -> noFx $ setAdmin model (admin { isAdmin = Just false })

      RefreshAdmin ->
        Tuple (setAdmin model (admin { error = Nothing })) refreshEffects

      GateLoaded gate ->
        noFx $ setAdmin model (admin { gate = acceptGate admin.gate gate })

      GateLoadFailed err ->
        noFx $ setAdmin model (admin { gate = keepLoaded admin.gate err, error = Just err })

      ProtectionsLoaded list ->
        noFx $ setAdmin model (admin { protections = Loaded list })

      ProtectionsLoadFailed err ->
        noFx $ setAdmin model (admin { protections = keepLoaded admin.protections err, error = Just err })

      WebhookLoaded webhook ->
        noFx $ setAdmin model (admin { webhook = Loaded webhook })

      WebhookLoadFailed err ->
        noFx $ setAdmin model (admin { webhook = keepLoaded admin.webhook err, error = Just err })

      NotificationsLoaded page ->
        noFx $ setAdmin model (admin { notifications = page.items, notificationsCursor = page.nextCursor, unread = page.unread })

      LoadMoreNotifications ->
        case admin.notificationsCursor of
          Just cursor | not admin.loadingMore ->
            Tuple (setAdmin model (admin { loadingMore = true }))
              [ deliver (Api.fetchNotifications (Just cursor)) MoreNotificationsLoaded NotificationsFailed ]
          _ -> noFx model

      MoreNotificationsLoaded page ->
        let
          known = map _.id admin.notifications
          fresh = filter (\n -> not (elem n.id known)) page.items
        in
          noFx $ setAdmin model
            (admin { notifications = admin.notifications <> fresh, notificationsCursor = page.nextCursor, unread = page.unread, loadingMore = false })

      NotificationsFailed err ->
        noFx $ setAdmin model (admin { error = Just err, loadingMore = false })

      ToggleBell ->
        if admin.bellOpen then noFx $ setAdmin model (admin { bellOpen = false })
        else Tuple (setAdmin model (admin { bellOpen = true })) [ fetchNotificationsAff ]

      CloseBell ->
        noFx $ setAdmin model (admin { bellOpen = false })

      MarkRead id ->
        case filter (\n -> n.id == id && not n.read) admin.notifications of
          [] -> noFx model
          _ -> Tuple model [ deliver (Api.markRead [ id ]) (UnreadUpdated [ id ]) MarkReadFailed ]

      MarkAllRead ->
        if admin.unread == 0 then noFx model
        else Tuple model [ deliver Api.markAllRead (UnreadUpdated (map _.id admin.notifications)) MarkReadFailed ]

      UnreadUpdated ids count ->
        noFx $ setAdmin model
          ( admin
              { notifications = map (\n -> if elem n.id ids then n { read = true } else n) admin.notifications
              , unread = count
              }
          )

      MarkReadFailed err ->
        noFx $ setAdmin model (admin { error = Just err })

      RunCommand command ->
        withGate model \gate ->
          let
            call = case command of
              OpenGate -> Api.openGate gate.revision
              CloseGate -> Api.closeGate gate.revision
              RevokeOverride -> Api.revokeOverride gate.revision
              EnableOverride -> Api.enableOverride gate.revision
          in
            Tuple (setAdmin model (admin { pending = true, error = Nothing }))
              [ deliver call (CommandDone command) CommandFailed ]

      CommandDone command gate ->
        let
          base = admin { gate = acceptGate admin.gate gate, pending = false, modal = Nothing, overrideAck = false, error = Nothing }
          Tuple withToast toastFx = case commandToast command of
            Just text -> showToast text base
            Nothing -> Tuple base []
        in
          Tuple (setAdmin model withToast) (toastFx <> [ fetchNotificationsAff ])

      CommandFailed err ->
        Tuple (setAdmin model (admin { pending = false, modal = Nothing, overrideAck = false, error = Just err }))
          (if refetchOnError err then [ fetchGateAff, fetchProtectionsAff ] else [])

      CommandPartial gate err ->
        Tuple (setAdmin model (admin { gate = acceptGate admin.gate gate, pending = false, modal = Nothing, error = Just err }))
          (if refetchOnError err then [ fetchGateAff ] else [])

      AdminForbidden ->
        -- 権限が無いと分かった時点で、管理画面の状態 (警告帯・通知を含む) を捨てて導線を消す。/admin/* は 404 になる
        noFx $ setAdmin model (emptyAdminModel { isAdmin = Just false, forbidden = true, toastSeq = admin.toastSeq })

      RequestRevoke origin ->
        withGate model \gate ->
          if gate.minimumMet then updateAdmin model (RunCommand RevokeOverride)
          else Tuple (setAdmin model (admin { modal = Just RevokeModal, modalOrigin = Just origin })) [ focusLater "revoke-cancel" ]

      ConfirmRevoke ->
        withGate model \gate ->
          let
            -- 条件を満たさない解除は「停止中 (管理者による停止)」にする (親判断 question-c33d7e52 (d)):
            -- 先に閉じてから解除するので、解除の間に無保護で開放のまま残らない
            -- 閉じる操作だけ成功して解除に失敗したときは、閉じた後の状態を保つ (CommandPartial)
            closeThenRevoke = do
              closed <- Api.closeGate gate.revision
              case closed of
                Left err -> pure (Just (failure CommandFailed err))
                Right g -> do
                  revoked <- Api.revokeOverride g.revision
                  pure $ Just $ case revoked of
                    Right done -> Admin (CommandDone RevokeOverride done)
                    Left err -> failure (CommandPartial g) err
            call =
              if gate.adminOpen then closeThenRevoke
              else deliver (Api.revokeOverride gate.revision) (CommandDone RevokeOverride) CommandFailed
          in
            Tuple (setAdmin model (admin { pending = true, modal = Nothing, error = Nothing })) [ call ]

      OpenOverrideModal origin ->
        Tuple (setAdmin model (admin { modal = Just OverrideModal, modalOrigin = Just origin, overrideAck = false })) [ focusLater "override-ack" ]

      SetOverrideAck checked ->
        noFx $ setAdmin model (admin { overrideAck = checked })

      ConfirmOverride ->
        if admin.overrideAck then
          withGate model \gate ->
            Tuple (setAdmin model (admin { pending = true, modal = Nothing, error = Nothing }))
              [ deliver (Api.enableOverride gate.revision) (CommandDone EnableOverride) CommandFailed ]
        else noFx model

      CloseModal ->
        closeModal

      Verify protection ->
        if elem protection admin.verifying then noFx model
        else
          Tuple (setAdmin model (admin { verifying = cons protection admin.verifying, error = Nothing }))
            [ deliver (Api.verifyProtection protection) (Verified protection) (VerifyFailed protection) ]

      Verified protection readiness ->
        let
          replace = case admin.protections of
            Loaded list -> Loaded (map (\p -> if p.protection == protection then readiness else p) list)
            other -> other
        in
          Tuple (setAdmin model (admin { protections = replace, verifying = delete protection admin.verifying }))
            [ fetchGateAff ]

      VerifyFailed protection err ->
        noFx $ setAdmin model (admin { verifying = delete protection admin.verifying, error = Just err })

      FailuresLoaded page ->
        noFx $ setAdmin model (admin { failures = page.items, failuresCursor = page.nextCursor })

      LoadMoreFailures ->
        case admin.failuresCursor of
          Just cursor | not admin.loadingMoreFailures ->
            Tuple (setAdmin model (admin { loadingMoreFailures = true }))
              [ deliver (Api.fetchFailures (Just cursor)) MoreFailuresLoaded FailuresFailed ]
          _ -> noFx model

      MoreFailuresLoaded page ->
        let
          fresh = filter (\f -> not (elem (failureKey f) (map failureKey admin.failures))) page.items
        in
          noFx $ setAdmin model
            (admin { failures = admin.failures <> fresh, failuresCursor = page.nextCursor, loadingMoreFailures = false })

      FailuresFailed err ->
        noFx $ setAdmin model (admin { error = Just err, loadingMoreFailures = false })

      OpenWebhookModal target origin ->
        let
          form = case target, admin.webhook of
            Just id, Loaded webhook -> case find (\e -> e.id == id && e.editable) webhook.endpoints of
              Just e -> Just
                ( emptyWebhookForm
                    { endpointId = Just e.id
                    , revision = e.revision
                    , maskedUrl = e.maskedUrl
                    , secretConfigured = e.secretConfigured
                    , categories = e.categories
                    , original = e.categories
                    }
                )
              Nothing -> Nothing
            Just _, _ -> Nothing
            -- 登録は送る通知をすべて選んだ状態で開く
            Nothing, _ -> Just (emptyWebhookForm { categories = allCategories })
        in
          case form of
            Just f -> Tuple (setAdmin model (admin { modal = Just WebhookModal, modalOrigin = Just origin, webhookForm = f })) [ focusLater "webhook-url" ]
            Nothing -> noFx model

      SetWebhookUrl url ->
        noFx $ setAdmin model (admin { webhookForm = admin.webhookForm { url = url, error = Nothing } })

      SetWebhookSecret secret ->
        noFx $ setAdmin model (admin { webhookForm = admin.webhookForm { secret = secret, error = Nothing } })

      SetWebhookCategory category checked ->
        let
          chosen = filter (\c -> if c == category then checked else elem c admin.webhookForm.categories) allCategories
        in
          noFx $ setAdmin model (admin { webhookForm = admin.webhookForm { categories = chosen, error = Nothing } })

      SaveWebhook ->
        let
          form = admin.webhookForm
          given text = if text == "" then Nothing else Just text
          call = case form.endpointId, form.revision of
            Just id, Just revision ->
              Just $ Api.updateEndpoint id
                { revision
                , url: given form.url
                , secret: given form.secret
                , categories: if categoriesChanged form then Just form.categories else Nothing
                }
            Nothing, _ -> Just $ Api.createEndpoint { url: form.url, secret: form.secret, categories: form.categories }
            _, _ -> Nothing
        in
          case call of
            Just c | not admin.pending && webhookFormSavable form ->
              Tuple (setAdmin model (admin { pending = true, webhookForm = form { error = Nothing } }))
                [ deliver c (const (WebhookSaved Text.toastSaved)) WebhookSaveFailed ]
            _ -> noFx model

      DeleteWebhook ->
        case admin.webhookForm.endpointId, admin.webhookForm.revision of
          Just id, Just revision | not admin.pending ->
            Tuple (setAdmin model (admin { pending = true, webhookForm = admin.webhookForm { error = Nothing } }))
              [ deliver (Api.deleteEndpoint id revision) (const (WebhookSaved Text.toastDeleted)) WebhookSaveFailed ]
          _, _ -> noFx model

      WebhookSaved text ->
        let
          -- 削除した送信先の［編集］は無くなるので、そのときは「＋」へフォーカスを戻す
          origin = if text == Text.toastDeleted then "webhook-add" else maybe "webhook-add" identity admin.modalOrigin
          Tuple next fx = showToast text (closedWebhookModal admin { pending = false, error = Nothing })
        in
          Tuple (setAdmin model next) (fx <> [ fetchWebhookAff, fetchFailuresAff, focusLater origin ])

      WebhookSaveFailed err ->
        if err == RevisionConflict || err == NotFound then
          -- 送信先が他の管理者に変えられた・消された: モーダルを閉じて最新を取り直す (入力は捨てる)
          Tuple (setAdmin model (closedWebhookModal admin { pending = false, error = Just err }))
            [ fetchWebhookAff, fetchFailuresAff ]
        else
          -- 入力を直せば保存し直せる失敗は、モーダルを開いたまま中に 1 行で出す
          noFx $ setAdmin model (admin { pending = false, webhookForm = admin.webhookForm { error = Just err } })

      TestWebhook endpointId ->
        if elem endpointId admin.testing then noFx model
        else
          Tuple (setAdmin model (admin { testing = cons endpointId admin.testing, error = Nothing }))
            [ deliver (Api.testWebhook endpointId) (WebhookTested endpointId) (WebhookTestFailed endpointId) ]

      WebhookTested endpointId delivered ->
        let
          Tuple next fx = showToast (if delivered then Text.toastTestSent else Text.toastTestFailed) (admin { testing = delete endpointId admin.testing })
        in
          Tuple (setAdmin model next) fx

      WebhookTestFailed endpointId err ->
        Tuple (setAdmin model (admin { testing = delete endpointId admin.testing, error = Just err }))
          (if refetchOnError err then [ fetchWebhookAff ] else [])

      RetryDelivery endpointId eventId ->
        let
          key = { endpointId, eventId }
        in
          if elem key admin.retrying then noFx model
          else
            Tuple (setAdmin model (admin { retrying = cons key admin.retrying, error = Nothing }))
              [ deliver (Api.retryDelivery endpointId eventId) (const (DeliveryRetried endpointId eventId)) (DeliveryRetryFailed endpointId eventId) ]

      DeliveryRetried endpointId eventId ->
        let
          key = { endpointId, eventId }
          -- 再キューした配送は配送失敗ではなくなる。読み込んだ古いページを保つため、一覧は取り直さずその行だけ外す
          Tuple next fx = showToast Text.toastRetried
            (admin { retrying = delete key admin.retrying, failures = filter (\f -> failureKey f /= key) admin.failures })
        in
          Tuple (setAdmin model next) (fx <> [ fetchWebhookAff ])

      DeliveryRetryFailed endpointId eventId err ->
        Tuple (setAdmin model (admin { retrying = delete { endpointId, eventId } admin.retrying, error = Just err }))
          [ fetchWebhookAff, fetchFailuresAff ]

      DismissToast id ->
        case admin.toast of
          Just toast | toast.id == id -> noFx $ setAdmin model (admin { toast = Nothing })
          _ -> noFx model

      KeyPressed key ->
        if key /= "Escape" then noFx model
        else if admin.modal /= Nothing then closeModal
        else if admin.bellOpen then Tuple (setAdmin model (admin { bellOpen = false })) [ focusLater "notification-bell" ]
        else noFx model
  where
  enterRouteEffects m = enterRoute m.route m
  -- 閉じたらモーダルを開いたボタンへフォーカスを戻す
  closeModal =
    Tuple (model { admin = (closedWebhookModal model.admin) { overrideAck = false } })
      (maybe [] (\origin -> [ focusLater origin ]) model.admin.modalOrigin)
