module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.InstanceRole (InstanceRole)
import Generated.Schema.Gql.Enum.ModerationType (ModerationType)
import Generated.Schema.Gql.Enum.ProfileUsernameCheck (ProfileUsernameCheck)
import Generated.Schema.Gql.Enum.ProfileUsernameState (ProfileUsernameState)
import Generated.Schema.Gql.Enum.RegistrationAdminState (RegistrationAdminState)
import Generated.Schema.Gql.Enum.RegistrationDecision (RegistrationDecision)
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind)
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus)
import Generated.Schema.Gql.Enum.RegistrationHealthEpisode (RegistrationHealthEpisode)
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus)
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection)
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus)
import Generated.Schema.Gql.Enum.RegistrationProtectionVerifyDisposition (RegistrationProtectionVerifyDisposition)
import Generated.Schema.Gql.Enum.RegistrationProtectionVerifyOutcome (RegistrationProtectionVerifyOutcome)
import Generated.Schema.Gql.Enum.RegistrationWebhookConfiguration (RegistrationWebhookConfiguration)
import Generated.Schema.Gql.Enum.RegistrationWebhookDeliveryStatus (RegistrationWebhookDeliveryStatus)
import GraphQL.Client.Args (NotNull)
import GraphQL.Client.AsGql (AsGql)
import GraphQL.Client.ID as GraphQL.Client.ID
import GraphQL.Client.Union as GraphQL.Client.Union
import Type.Proxy as Type.Proxy

type Schema =
  { directives :: Type.Proxy.Proxy Directives
  , query :: Query
  , mutation :: Mutation
  , subscription :: Data.Void.Void
  }

type DateTime = String
type Id =
  -- | The `ID` scalar type represents a unique identifier, often used to refetch an object or as key for a cache. The ID type appears in a JSON response as a String; however, it is not intended to be human-readable. When expected as an input type, any string (such as `"4"`) or integer (such as `4`) input value will be accepted as an ID.
  GraphQL.Client.ID.ID

newtype Query = Query
  { accounts :: {} -> AsGql "AccountConnection" AccountConnection
  , registrationGate :: {} -> AsGql "RegistrationGate" RegistrationGate
  , registrationGateUnreadCount :: {} -> AsGql "Int" Int
  , registrationProtections ::
      {} -> Array (AsGql "RegistrationProtectionReadiness" RegistrationProtectionReadiness)
  , registrationWebhook :: {} -> AsGql "RegistrationWebhookStatus" RegistrationWebhookStatus
  , viewer :: {} -> AsGql "Viewer" Viewer
  , account ::
      { id :: NotNull (AsGql "ID" GraphQL.Client.ID.ID) }
      -> AsGql "Account" (Data.Maybe.Maybe (AsGql "Account" Account))
  , registrationGateNotifications ::
      { before :: AsGql "String" String, limit :: AsGql "Int" Int }
      ->
      -- | limit は 1〜100 (既定 50)、before は前ページ最後の通知 ID
      AsGql "RegistrationGateNotificationConnection" RegistrationGateNotificationConnection
  , checkProfileUsername ::
      { username :: NotNull (AsGql "String" String) }
      ->
      -- | 入力中の検証用。Emumet は呼ばず規則 (形式・予約語) だけを判定する
      AsGql "ProfileUsernameCheck" ProfileUsernameCheck
  }

derive instance Data.Newtype.Newtype Query _
newtype RegistrationProtectionObservation = RegistrationProtectionObservation
  { configured :: {} -> AsGql "Boolean" Boolean
  , probe :: {} -> AsGql "RegistrationProbeStatus" RegistrationProbeStatus
  }

derive instance Data.Newtype.Newtype RegistrationProtectionObservation _
newtype RegistrationGateNotification = RegistrationGateNotification
  { createdAt :: {} -> AsGql "String" String
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , kind :: {} -> AsGql "RegistrationGateEventKind" RegistrationGateEventKind
  , observation :: {} -> AsGql "RegistrationObservation" RegistrationObservation
  , readAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , revision :: {} -> AsGql "Int" Int
  , actor ::
      {}
      ->
      -- | override の開始・解除を実行した管理者 (auth account ID)
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , read ::
      {}
      ->
      -- | 呼び出した管理者自身の既読状態 (管理者間で共有されない)
      AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype RegistrationGateNotification _
newtype Account = Account
  { createdAt :: {} -> AsGql "DateTime" DateTime
  , id :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , isBot :: {} -> AsGql "Boolean" Boolean
  , metadata :: {} -> Array (AsGql "Metadata" Metadata)
  , moderation :: {} -> AsGql "Moderation" (Data.Maybe.Maybe (AsGql "Moderation" Moderation))
  , name :: {} -> AsGql "String" String
  , profile :: {} -> AsGql "Profile" (Data.Maybe.Maybe (AsGql "Profile" Profile))
  , publicKey ::
      {}
      ->
      -- | Emumet は Account 単位の鍵を返さない (Profile モデル移行で廃止)。実 Emumet 接続時は値を持たず常に空文字。画面側の非表示・nullable 化は画面 PR
      AsGql "String" String
  , profileUsername ::
      {}
      ->
      -- | profileId の Profile の username。profileId があるのに null なら未設定 (一回限り設定できる)。Account 名から導出しない
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , profileId ::
      {}
      ->
      -- | この Account を記述する Profile の nanoid (組織 Account は最小 id の Profile)。Profile を持たない場合は null
      AsGql "ID" (Data.Maybe.Maybe (AsGql "ID" GraphQL.Client.ID.ID))
  }

derive instance Data.Newtype.Newtype Account _
newtype AccountConnection = AccountConnection
  { first :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , items :: {} -> Array (AsGql "Account" Account)
  , last :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  }

derive instance Data.Newtype.Newtype AccountConnection _
newtype Profile = Profile
  { accountId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , bannerUrl :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , displayName :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , iconUrl :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , nanoid :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , summary :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , username ::
      {}
      ->
      -- | acct の名前部分。一度だけ設定でき、変更できない。未設定 (既存 Profile) は null。Account 名や所有者 (移管先) から導出しない
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , usernameState ::
      {}
      ->
      -- | username の状態。UNSET なら setProfileUsername で一回限り設定できる。SET は変更不可
      AsGql "ProfileUsernameState" ProfileUsernameState
  }

derive instance Data.Newtype.Newtype Profile _
newtype RegistrationGateNotificationConnection = RegistrationGateNotificationConnection
  { notifications :: {} -> Array (AsGql "RegistrationGateNotification" RegistrationGateNotification)
  , unreadCount ::
      {}
      ->
      -- | 呼び出した管理者自身の未読件数 (ページ範囲ではなく全体)
      AsGql "Int" Int
  , nextCursor ::
      {}
      ->
      -- | 次ページ取得用の before。最後のページでは null
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  }

derive instance Data.Newtype.Newtype RegistrationGateNotificationConnection _
newtype RegistrationProtectionVerification = RegistrationProtectionVerification
  { disposition ::
      {} -> AsGql "RegistrationProtectionVerifyDisposition" RegistrationProtectionVerifyDisposition
  , outcome :: {} -> AsGql "RegistrationProtectionVerifyOutcome" RegistrationProtectionVerifyOutcome
  , readiness :: {} -> AsGql "RegistrationProtectionReadiness" RegistrationProtectionReadiness
  , reason :: {} -> AsGql "String" String
  , recorded ::
      {}
      ->
      -- | readiness へ記録したか
      AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype RegistrationProtectionVerification _
newtype RegistrationWebhookCounts = RegistrationWebhookCounts
  { delivered :: {} -> AsGql "Int" Int
  , failed :: {} -> AsGql "Int" Int
  , inFlight :: {} -> AsGql "Int" Int
  , pending :: {} -> AsGql "Int" Int
  , retrying :: {} -> AsGql "Int" Int
  }

derive instance Data.Newtype.Newtype RegistrationWebhookCounts _
newtype Moderation = Moderation
  { bannedAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , expiresAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , reason :: {} -> AsGql "String" String
  , suspendedAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , type :: {} -> AsGql "ModerationType" ModerationType
  }

derive instance Data.Newtype.Newtype Moderation _
newtype RegistrationObservation = RegistrationObservation
  { bot :: {} -> AsGql "RegistrationProtectionObservation" RegistrationProtectionObservation
  , email :: {} -> AsGql "RegistrationProtectionObservation" RegistrationProtectionObservation
  , enforcementVerified ::
      {}
      ->
      -- | E15d: 登録の保護 (Kratos hook) が現在の deployment で適用されている証明。false の間は開放・再開・override が PRECONDITION_FAILED
      AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype RegistrationObservation _
newtype RegistrationWebhookTestResult = RegistrationWebhookTestResult
  { attemptedAt :: {} -> AsGql "String" String
  , httpStatus :: {} -> AsGql "Int" (Data.Maybe.Maybe (AsGql "Int" Int))
  , delivered ::
      {}
      ->
      -- | 受信側が 2xx を返したら true
      AsGql "Boolean" Boolean
  , result ::
      {}
      ->
      -- | 結果の分類 (配送記録の lastResult と同じ語彙)
      AsGql "String" String
  }

derive instance Data.Newtype.Newtype RegistrationWebhookTestResult _
newtype RegistrationGate = RegistrationGate
  { accepting :: {} -> AsGql "Boolean" Boolean
  , adminState :: {} -> AsGql "RegistrationAdminState" RegistrationAdminState
  , configLostLatch :: {} -> AsGql "Boolean" Boolean
  , decision :: {} -> AsGql "RegistrationDecision" RegistrationDecision
  , healthEpisode :: {} -> AsGql "RegistrationHealthEpisode" RegistrationHealthEpisode
  , observation :: {} -> AsGql "RegistrationObservation" RegistrationObservation
  , override :: {} -> AsGql "RegistrationOverride" RegistrationOverride
  , updatedAt :: {} -> AsGql "String" String
  , enforcementLostLatch ::
      {}
      ->
      -- | E15d: 適用証明の喪失による停止ラッチ (override 中でも STOPPED。復旧後も手動再開が必要)
      AsGql "Boolean" Boolean
  , requiresManualResume ::
      {}
      ->
      -- | decision が STOPPED のとき true。復旧しても自動再開しない
      AsGql "Boolean" Boolean
  , minimumMet ::
      {}
      ->
      -- | 最低条件 (メール認証か BOT 保護の少なくとも一方が設定済みかつ応答あり) を満たすか。false なら開放・再開は PRECONDITION_FAILED
      AsGql "Boolean" Boolean
  , revision ::
      {}
      ->
      -- | 楽観ロック用。変更系の mutation はこの値を送り、不一致は REVISION_CONFLICT
      AsGql "Int" Int
  , enforcedProtections ::
      {}
      ->
      -- | 登録時に課す対策 (検証 API が実際に応答した対策のみ)
      Array (AsGql "RegistrationProtection" RegistrationProtection)
  , status ::
      {}
      ->
      -- | 管理画面の状態チップ (BFF が decision・adminState・revision・override から導出。registration-gate-status.ts)
      AsGql "RegistrationGateStatus" RegistrationGateStatus
  , degradedProtections ::
      {}
      ->
      -- | 防御低下: 設定済みだが検証 API が応答しない対策
      Array (AsGql "RegistrationProtection" RegistrationProtection)
  }

derive instance Data.Newtype.Newtype RegistrationGate _
newtype Mutation = Mutation
  { markAllRegistrationGateNotificationsRead :: {} -> AsGql "Int" Int
  , sendRegistrationWebhookTest ::
      {}
      ->
      -- | テスト送信 (1 回のみ・記録しない)。未設定・設定不備なら WEBHOOK_NOT_CONFIGURED
      AsGql "RegistrationWebhookTestResult" RegistrationWebhookTestResult
  , updateProfile ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpdateProfileInput" UpdateProfileInput)
      }
      -> AsGql "Profile" Profile
  , createMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpsertMetadataInput" UpsertMetadataInput)
      }
      ->
      -- | 実 Emumet 接続時は未対応 (UNSUPPORTED): fields の項目 ID・revision が Emumet に無く安全に書けない (後続課題)
      AsGql "Metadata" Metadata
  , deleteMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , nanoid :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | 実 Emumet 接続時は未対応 (UNSUPPORTED): fields の項目 ID・revision が Emumet に無く安全に書けない (後続課題)
      AsGql "Boolean" Boolean
  , updateMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpsertMetadataInput" UpsertMetadataInput)
      , nanoid :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | 実 Emumet 接続時は未対応 (UNSUPPORTED): fields の項目 ID・revision が Emumet に無く安全に書けない (後続課題)
      AsGql "Metadata" Metadata
  , retryRegistrationWebhook ::
      { eventId :: AsGql "ID" GraphQL.Client.ID.ID }
      ->
      -- | eventId の failed 配送を再キューする (省略で failed 全件)。戻り値は再キュー件数。対象が無ければ NOT_FOUND
      AsGql "Int" Int
  , markRegistrationGateNotificationsRead ::
      { eventIds :: NotNull (Array (NotNull (AsGql "ID" GraphQL.Client.ID.ID))) }
      ->
      -- | 戻り値は既読化後の未読件数
      AsGql "Int" Int
  , createAccount ::
      { input :: NotNull (AsGql "CreateAccountInput" CreateAccountInput) } -> AsGql "Account" Account
  , setProfileUsername ::
      { profileId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , username :: NotNull (AsGql "String" String)
      }
      ->
      -- | username が未設定の Profile (profileId は nanoid) に一度だけ設定する。設定済みは USERNAME_ALREADY_SET
      AsGql "Profile" Profile
  , verifyRegistrationProtection ::
      { protection :: NotNull (AsGql "RegistrationProtection" RegistrationProtection) }
      ->
      -- | 入力なしの検証 (bot は secret の負の probe、email は canary mailbox への送信)。未知の保護は NOT_FOUND
      AsGql "RegistrationProtectionVerification" RegistrationProtectionVerification
  , closeRegistrationGate ::
      { revision :: NotNull (AsGql "Int" Int) } -> AsGql "RegistrationGate" RegistrationGate
  , revokeRegistrationGateOverride ::
      { revision :: NotNull (AsGql "Int" Int) } -> AsGql "RegistrationGate" RegistrationGate
  , openRegistrationGate ::
      { revision :: NotNull (AsGql "Int" Int) }
      ->
      -- | 開放。設定喪失で停止中の手動再開も同じ操作。最低条件 (メール認証 OR BOT 対策) を満たさなければ PRECONDITION_FAILED
      AsGql "RegistrationGate" RegistrationGate
  , enableRegistrationGateOverride ::
      { acknowledgeWarning :: NotNull (AsGql "Boolean" Boolean)
      , revision :: NotNull (AsGql "Int" Int)
      }
      ->
      -- | acknowledgeWarning が false なら BAD_REQUEST。override は明示解除まで有効
      AsGql "RegistrationGate" RegistrationGate
  }

derive instance Data.Newtype.Newtype Mutation _
-- | Account の fields の 1 件。nanoid は fields 内の位置 (0 始まりの index)。削除すると後続の位置が繰り上がる
newtype Metadata = Metadata
  { accountId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , content :: {} -> AsGql "String" String
  , label :: {} -> AsGql "String" String
  , nanoid :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype Metadata _
-- | Webhook の配送状態 (E15w)。endpoint と secret はサーバー設定のみで、宛先は host だけを返す
newtype RegistrationWebhookStatus = RegistrationWebhookStatus
  { configuration :: {} -> AsGql "RegistrationWebhookConfiguration" RegistrationWebhookConfiguration
  , counts :: {} -> AsGql "RegistrationWebhookCounts" RegistrationWebhookCounts
  , lastFailureAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , lastSuccessAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , issue ::
      {}
      ->
      -- | MISCONFIGURED のときの不備の分類 (固定語彙)
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , destinationHost ::
      {}
      ->
      -- | 宛先の host 部分のみ (userinfo・port・path・query・secret は出さない)
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , recentDeliveries ::
      {}
      ->
      -- | 新しい順の直近の配送記録
      Array (AsGql "RegistrationWebhookDelivery" RegistrationWebhookDelivery)
  }

derive instance Data.Newtype.Newtype RegistrationWebhookStatus _
-- | Webhook の配送記録 (本文・宛先 URL・secret は含まない)
newtype RegistrationWebhookDelivery = RegistrationWebhookDelivery
  { attemptCount :: {} -> AsGql "Int" Int
  , createdAt :: {} -> AsGql "String" String
  , deliveredAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , eventType :: {} -> AsGql "RegistrationGateEventKind" RegistrationGateEventKind
  , lastAttemptAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , status :: {} -> AsGql "RegistrationWebhookDeliveryStatus" RegistrationWebhookDeliveryStatus
  , failureReason ::
      {}
      ->
      -- | failed のときの理由 (permanent_error / retries_exhausted)
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , lastResult ::
      {}
      ->
      -- | 固定語彙の結果分類 (timeout / http_server_error など)
      AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , eventId ::
      {}
      ->
      -- | 通知イベント ID (再試行・再送で不変)
      AsGql "ID" GraphQL.Client.ID.ID
  }

derive instance Data.Newtype.Newtype RegistrationWebhookDelivery _
-- | override の状態。decision とは独立で、管理者閉鎖中でも active のまま保持される
newtype RegistrationOverride = RegistrationOverride
  { activatedAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , activatedBy :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , active :: {} -> AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype RegistrationOverride _
-- | 保護 (メール認証・BOT 保護) の準備状態 (E15c)。secret・fingerprint・設定値は含まない
newtype RegistrationProtectionReadiness = RegistrationProtectionReadiness
  { checkedAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , protection :: {} -> AsGql "RegistrationProtection" RegistrationProtection
  , status :: {} -> AsGql "RegistrationProtectionStatus" RegistrationProtectionStatus
  , validUntil :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , enabled ::
      {}
      ->
      -- | 設定が有効か (未設定・明示無効は false)
      AsGql "Boolean" Boolean
  , reason ::
      {}
      ->
      -- | 評価の理由 (Emumet の固定語彙。例 invalid_secret / timeout)
      AsGql "String" String
  }

derive instance Data.Newtype.Newtype RegistrationProtectionReadiness _
-- | 呼び出し者 (GET /api/v1/me)。管理画面の導線を出すかのヒントで、権限判断の正本ではない (各管理 API が FORBIDDEN を返す)
newtype Viewer = Viewer
  { accountId :: {} -> AsGql "ID" GraphQL.Client.ID.ID
  , instanceRoles :: {} -> Array (AsGql "InstanceRole" InstanceRole)
  , isAdmin ::
      {}
      ->
      -- | instanceRoles に ADMIN を含む
      AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype Viewer _
newtype UpdateProfileInput = UpdateProfileInput
  { bannerUrl :: AsGql "String" String
  , displayName :: AsGql "String" String
  , iconUrl :: AsGql "String" String
  , summary :: AsGql "String" String
  }

derive instance Data.Newtype.Newtype UpdateProfileInput _
newtype UpsertMetadataInput = UpsertMetadataInput
  { content :: NotNull (AsGql "String" String), label :: NotNull (AsGql "String" String) }

derive instance Data.Newtype.Newtype UpsertMetadataInput _
newtype CreateAccountInput = CreateAccountInput
  { isBot :: AsGql "Boolean" Boolean
  , name :: NotNull (AsGql "String" String)
  , username ::
      -- | Profile の username (Account 名とは別入力)。新 UI は必ず送る。省略は旧経路との互換のための暂定 (画面実装 PR で String! にする)
      AsGql "String" String
  }

derive instance Data.Newtype.Newtype CreateAccountInput _
