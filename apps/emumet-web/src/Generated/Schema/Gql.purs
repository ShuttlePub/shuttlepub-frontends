module Generated.Schema.Gql where

import Data.Argonaut.Core as Data.Argonaut.Core
import Data.Maybe as Data.Maybe
import Data.Newtype as Data.Newtype
import Data.Void as Data.Void
import Generated.Directives.Gql (Directives)
import Generated.Schema.Gql.Enum.ModerationType (ModerationType)
import Generated.Schema.Gql.Enum.ProfileUsernameCheck (ProfileUsernameCheck)
import Generated.Schema.Gql.Enum.ProfileUsernameState (ProfileUsernameState)
import Generated.Schema.Gql.Enum.RegistrationAdminState (RegistrationAdminState)
import Generated.Schema.Gql.Enum.RegistrationDecision (RegistrationDecision)
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind)
import Generated.Schema.Gql.Enum.RegistrationHealthEpisode (RegistrationHealthEpisode)
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus)
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection)
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
newtype RegistrationObservation = RegistrationObservation
  { bot :: {} -> AsGql "RegistrationProtectionObservation" RegistrationProtectionObservation
  , email :: {} -> AsGql "RegistrationProtectionObservation" RegistrationProtectionObservation
  }

derive instance Data.Newtype.Newtype RegistrationObservation _
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
newtype Moderation = Moderation
  { bannedAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , expiresAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , reason :: {} -> AsGql "String" String
  , suspendedAt :: {} -> AsGql "DateTime" (Data.Maybe.Maybe (AsGql "DateTime" DateTime))
  , type :: {} -> AsGql "ModerationType" ModerationType
  }

derive instance Data.Newtype.Newtype Moderation _
newtype RegistrationGate = RegistrationGate
  { accepting :: {} -> AsGql "Boolean" Boolean
  , adminState :: {} -> AsGql "RegistrationAdminState" RegistrationAdminState
  , configLostLatch :: {} -> AsGql "Boolean" Boolean
  , decision :: {} -> AsGql "RegistrationDecision" RegistrationDecision
  , healthEpisode :: {} -> AsGql "RegistrationHealthEpisode" RegistrationHealthEpisode
  , observation :: {} -> AsGql "RegistrationObservation" RegistrationObservation
  , override :: {} -> AsGql "RegistrationOverride" RegistrationOverride
  , updatedAt :: {} -> AsGql "String" String
  , requiresManualResume ::
      {}
      ->
      -- | decision が STOPPED のとき true。復旧しても自動再開しない
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
  , degradedProtections ::
      {}
      ->
      -- | 防御低下: 設定済みだが検証 API が応答しない対策
      Array (AsGql "RegistrationProtection" RegistrationProtection)
  }

derive instance Data.Newtype.Newtype RegistrationGate _
newtype Mutation = Mutation
  { markAllRegistrationGateNotificationsRead :: {} -> AsGql "Int" Int
  , updateProfile ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpdateProfileInput" UpdateProfileInput)
      }
      -> AsGql "Profile" Profile
  , createMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpsertMetadataInput" UpsertMetadataInput)
      }
      -> AsGql "Metadata" Metadata
  , deleteMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , nanoid :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      ->
      -- | 実 Emumet 接続時は未対応 (UNSUPPORTED): nanoid が fields 内の位置のため、画面が削除後に位置を振り直すまで安全に削除できない
      AsGql "Boolean" Boolean
  , updateMetadata ::
      { accountId :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      , input :: NotNull (AsGql "UpsertMetadataInput" UpsertMetadataInput)
      , nanoid :: NotNull (AsGql "ID" GraphQL.Client.ID.ID)
      }
      -> AsGql "Metadata" Metadata
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
-- | override の状態。decision とは独立で、管理者閉鎖中でも active のまま保持される
newtype RegistrationOverride = RegistrationOverride
  { activatedAt :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , activatedBy :: {} -> AsGql "String" (Data.Maybe.Maybe (AsGql "String" String))
  , active :: {} -> AsGql "Boolean" Boolean
  }

derive instance Data.Newtype.Newtype RegistrationOverride _
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
