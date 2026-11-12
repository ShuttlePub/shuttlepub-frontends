module App.Admin.Types where

import Prelude

import Data.Argonaut.Decode (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Array (null, sort)
import Data.Maybe (Maybe(..), isJust)
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind)
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus)
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus)
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection)
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus)
import Generated.Schema.Gql.Enum.RegistrationWebhookCategory (RegistrationWebhookCategory(..))
import Generated.Schema.Gql.Enum.RegistrationWebhookEndpointStatus (RegistrationWebhookEndpointStatus)

-- | 一般登録の状態。status / minimumMet の判定は BFF (registration-gate-status.ts) が行い、画面は表示するだけ
type Gate =
  { revision :: Int
  , status :: RegistrationGateStatus
  , minimumMet :: Boolean
  , adminOpen :: Boolean
  , overrideActive :: Boolean
  , enforcementVerified :: Boolean
  }

type ProtectionObservation =
  { configured :: Boolean
  , probe :: RegistrationProbeStatus
  }

type Protection =
  { protection :: RegistrationProtection
  , enabled :: Boolean
  , status :: RegistrationProtectionStatus
  , reason :: String
  , checkedAt :: Maybe String
  }

type Notification =
  { id :: String
  , kind :: RegistrationGateEventKind
  , read :: Boolean
  , createdAt :: String
  , email :: ProtectionObservation
  , bot :: ProtectionObservation
  }

-- | Webhook の送信先。URL は部分マスク形 (maskedUrl) だけ。シークレットは BFF も返さない
type Endpoint =
  { id :: String
  , maskedUrl :: String
  , categories :: Array RegistrationWebhookCategory
  , status :: RegistrationWebhookEndpointStatus
  , failingReasons :: Array String
  , configIssue :: Maybe String
  , secretConfigured :: Boolean
  , editable :: Boolean
  , revision :: Maybe Int
  }

type Webhook =
  { endpoints :: Array Endpoint
  , hasFailedDeliveries :: Boolean
  }

-- | 配送失敗 (failed になった配送)。成功した配送の履歴は扱わない
type Failure =
  { endpointId :: String
  , eventId :: String
  , eventType :: RegistrationGateEventKind
  , failedAt :: String
  }

type FailurePage = { items :: Array Failure, nextCursor :: Maybe String }

-- | 送信先の登録・編集モーダルの入力。URL・シークレットは空で開き、入力したときだけ送る (空 = 変更しない)
type WebhookForm =
  { endpointId :: Maybe String
  , revision :: Maybe Int
  , maskedUrl :: String
  , secretConfigured :: Boolean
  , url :: String
  , secret :: String
  , categories :: Array RegistrationWebhookCategory
  , original :: Array RegistrationWebhookCategory
  -- モーダルの中に出す失敗の 1 行 (入力を直せば保存し直せるもの)
  , error :: Maybe GateError
  }

emptyWebhookForm :: WebhookForm
emptyWebhookForm =
  { endpointId: Nothing
  , revision: Nothing
  , maskedUrl: ""
  , secretConfigured: false
  , url: ""
  , secret: ""
  , categories: []
  , original: []
  , error: Nothing
  }

-- | 操作・取得の失敗。状態 (Gate) とは別の型で、競合・前提条件・一時障害・権限なしを混同しない
data GateError
  = Unauthenticated
  | Forbidden
  | RevisionConflict
  | PreconditionFailed
  | TemporarilyUnavailable
  | NotFound
  | WebhookNotConfigured
  -- | 送信先の登録・更新・削除の拒否 (API の固定コード。語彙外は Nothing)。revision 競合とは別
  | WebhookRejected (Maybe String)
  | Unexpected

derive instance Generic GateError _
derive instance Eq GateError

instance EncodeJson GateError where
  encodeJson = genericEncodeJson

instance DecodeJson GateError where
  decodeJson = genericDecodeJson

data AdminModal
  = OverrideModal
  | RevokeModal
  | WebhookModal

derive instance Generic AdminModal _
derive instance Eq AdminModal

instance EncodeJson AdminModal where
  encodeJson = genericEncodeJson

instance DecodeJson AdminModal where
  decodeJson = genericDecodeJson

data Loadable a
  = NotLoaded
  | Loaded a
  | LoadFailed GateError

derive instance Generic (Loadable a) _

instance EncodeJson a => EncodeJson (Loadable a) where
  encodeJson = genericEncodeJson

instance DecodeJson a => DecodeJson (Loadable a) where
  decodeJson = genericDecodeJson

type Toast = { id :: Int, text :: String }

type AdminModel =
  { isAdmin :: Maybe Boolean
  , gate :: Loadable Gate
  , protections :: Loadable (Array Protection)
  , webhook :: Loadable Webhook
  , failures :: Array Failure
  -- 配送失敗の次のページの before (最後のページでは Nothing)
  , failuresCursor :: Maybe String
  , loadingMoreFailures :: Boolean
  , webhookForm :: WebhookForm
  , notifications :: Array Notification
  -- 次のページの before (最後のページでは Nothing)
  , notificationsCursor :: Maybe String
  , loadingMore :: Boolean
  , unread :: Int
  , bellOpen :: Boolean
  , modal :: Maybe AdminModal
  -- モーダルを開いたボタンの id (閉じたらそこへフォーカスを戻す)
  , modalOrigin :: Maybe String
  , overrideAck :: Boolean
  , pending :: Boolean
  , verifying :: Array RegistrationProtection
  -- テスト送信中の送信先 ID
  , testing :: Array String
  -- 再試行中の配送 (送信先 ID と event ID)
  , retrying :: Array { endpointId :: String, eventId :: String }
  -- 直近の操作・取得の失敗 (管理画面の上部に 1 行で出す)。成功した操作・再取得で消える
  , error :: Maybe GateError
  , toast :: Maybe Toast
  , toastSeq :: Int
  -- 管理 API が FORBIDDEN を返した。管理者のヒント (viewer) より優先し、管理画面と導線を出さない
  , forbidden :: Boolean
  }

emptyAdminModel :: AdminModel
emptyAdminModel =
  { isAdmin: Nothing
  , gate: NotLoaded
  , protections: NotLoaded
  , webhook: NotLoaded
  , failures: []
  , failuresCursor: Nothing
  , loadingMoreFailures: false
  , webhookForm: emptyWebhookForm
  , notifications: []
  , notificationsCursor: Nothing
  , loadingMore: false
  , unread: 0
  , bellOpen: false
  , modal: Nothing
  , modalOrigin: Nothing
  , overrideAck: false
  , pending: false
  , verifying: []
  , testing: []
  , retrying: []
  , error: Nothing
  , toast: Nothing
  , toastSeq: 0
  , forbidden: false
  }

-- | 取得した状態を反映する。現在値より古い revision の応答 (操作の前に出した GET が後から届いたもの) は捨て、
-- | 操作で進んだ状態を巻き戻さない
acceptGate :: Loadable Gate -> Gate -> Loadable Gate
acceptGate current incoming = case current of
  Loaded known | known.revision > incoming.revision -> current
  _ -> Loaded incoming

type NotificationPage = { items :: Array Notification, unread :: Int, nextCursor :: Maybe String }

data GateCommand
  = OpenGate
  | CloseGate
  | RevokeOverride
  | EnableOverride

derive instance Eq GateCommand

data AdminMsg
  = ViewerLoaded Boolean
  -- 呼び出し者の取得が一時障害 (503・通信失敗など)。権限の判断材料ではないので、取得済みの管理者状態は失効させない
  | ViewerUnavailable
  | RefreshAdmin
  | GateLoaded Gate
  | GateLoadFailed GateError
  | ProtectionsLoaded (Array Protection)
  | ProtectionsLoadFailed GateError
  | WebhookLoaded Webhook
  | WebhookLoadFailed GateError
  | NotificationsLoaded NotificationPage
  | LoadMoreNotifications
  | MoreNotificationsLoaded NotificationPage
  | NotificationsFailed GateError
  | ToggleBell
  | CloseBell
  | MarkRead String
  | MarkAllRead
  | UnreadUpdated (Array String) Int
  | MarkReadFailed GateError
  | RunCommand GateCommand
  | CommandDone GateCommand Gate
  | CommandFailed GateError
  -- 条件未達の解除で、閉じる操作は成功したが解除に失敗した (閉じた後の状態は保つ)
  | CommandPartial Gate GateError
  -- 管理 API の FORBIDDEN: 管理画面の状態を捨て、導線を消して /admin/* を 404 にする
  | AdminForbidden
  | RequestRevoke String
  | ConfirmRevoke
  | OpenOverrideModal String
  | SetOverrideAck Boolean
  | ConfirmOverride
  | CloseModal
  | Verify RegistrationProtection
  | Verified RegistrationProtection Protection
  | VerifyFailed RegistrationProtection GateError
  | FailuresLoaded FailurePage
  | LoadMoreFailures
  | MoreFailuresLoaded FailurePage
  | FailuresFailed GateError
  -- 送信先の登録 (Nothing) / 編集 (送信先 ID)。2 つ目はモーダルを開いたボタンの id
  | OpenWebhookModal (Maybe String) String
  | SetWebhookUrl String
  | SetWebhookSecret String
  | SetWebhookCategory RegistrationWebhookCategory Boolean
  | SaveWebhook
  | DeleteWebhook
  | WebhookSaved String
  | WebhookSaveFailed GateError
  | TestWebhook String
  | WebhookTested String Boolean
  | WebhookTestFailed String GateError
  | RetryDelivery String String
  | DeliveryRetried String String
  | DeliveryRetryFailed String String GateError
  | DismissToast Int
  | KeyPressed String

-- | 送る通知の並び (モーダルのチェックボックスの順)
allCategories :: Array RegistrationWebhookCategory
allCategories = [ OUTAGE, RECOVERY, AUTO_STOP, OVERRIDE ]

isEditing :: WebhookForm -> Boolean
isEditing form = isJust form.endpointId

-- | 送る通知が変わったか (順序は問わない)
categoriesChanged :: WebhookForm -> Boolean
categoriesChanged form = sort form.categories /= sort form.original

-- | ［保存］を押せるか。登録は URL・シークレット・送る通知が全部要る。編集は送る通知を 1 つ以上残したうえで、
-- | どれかを変えたとき (URL・シークレットは入力したときだけ置き換える)
webhookFormSavable :: WebhookForm -> Boolean
webhookFormSavable form =
  not (null form.categories)
    &&
      if isEditing form then form.url /= "" || form.secret /= "" || categoriesChanged form
      else form.url /= "" && form.secret /= ""
