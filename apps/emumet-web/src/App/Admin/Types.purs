module App.Admin.Types where

import Prelude

import Data.Argonaut.Decode (class DecodeJson)
import Data.Argonaut.Decode.Generic (genericDecodeJson)
import Data.Argonaut.Encode (class EncodeJson)
import Data.Argonaut.Encode.Generic (genericEncodeJson)
import Data.Generic.Rep (class Generic)
import Data.Maybe (Maybe(..))
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind)
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus)
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus)
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection)
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus)
import Generated.Schema.Gql.Enum.RegistrationWebhookConfiguration (RegistrationWebhookConfiguration)
import Generated.Schema.Gql.Enum.RegistrationWebhookDeliveryStatus (RegistrationWebhookDeliveryStatus)

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

type Delivery =
  { eventId :: String
  , eventType :: RegistrationGateEventKind
  , status :: RegistrationWebhookDeliveryStatus
  , createdAt :: String
  , lastAttemptAt :: Maybe String
  }

-- | Webhook の配送状態。宛先は host のみ (URL 全体・シークレットは BFF も扱わない)
type Webhook =
  { configuration :: RegistrationWebhookConfiguration
  , issue :: Maybe String
  , destinationHost :: Maybe String
  , failedCount :: Int
  , deliveries :: Array Delivery
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
  , testing :: Boolean
  , retrying :: Array String
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
  , testing: false
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
  | ViewerFailed
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
  | TestWebhook
  | WebhookTested Boolean
  | WebhookTestFailed GateError
  | RetryDelivery String
  | DeliveryRetried String
  | DeliveryRetryFailed String GateError
  | DismissToast Int
  | KeyPressed String
