-- | 登録ゲート管理画面の文言と色 (ui-spec「モック A v5」)。画面の文言はこのモジュールだけに置く。
-- | ui-spec の (?) (ヘルプへの導線) は、ヘルプの置き場所が決まるまで出さない (リード回答 question-9f866320)。
-- | ui-spec に無かった文言 (通知タイトル・失敗の 1 行表示・「保護が未適用」・短い理由・時刻表記・［さらに読み込む］) は
-- | リード承認済み (question-f24eeb05)。引き算の方針なので、これより長い説明文は足さない。
-- | Webhook の登録・編集で足した拒否の 1 行 (「シークレットが長い」「登録済みの URL」「これ以上登録できません」「暗号鍵が未設定」)
-- | もリード承認済み (question-012f38e5)。「保存しました」「削除しました」「Webhook を追加」はモック A v5 の文言。
module App.Admin.Text where

import Prelude

import App.Admin.Types (GateError(..), ProtectionObservation)
import Data.Array (elem, filter, intercalate, null)
import Data.Maybe (Maybe(..))
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind(..))
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus(..))
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus(..))
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection(..))
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus(..))
import Generated.Schema.Gql.Enum.RegistrationWebhookCategory (RegistrationWebhookCategory)
import Generated.Schema.Gql.Enum.RegistrationWebhookCategory as Category

-- | 状態チップ・通知の色
data Tone = Success | Warning | Danger | Muted | Info

derive instance Eq Tone

toneClass :: Tone -> String
toneClass = case _ of
  Success -> "text-success"
  Warning -> "text-warning"
  Danger -> "text-error"
  Muted -> "text-muted-strong"
  Info -> "text-info"

-- ---------------------------------------------------------------------------
-- 共通
-- ---------------------------------------------------------------------------

adminTitle :: String
adminTitle = "管理"

tabRegistration :: String
tabRegistration = "一般登録"

tabWebhook :: String
tabWebhook = "Webhook"

webhookFailingMark :: String
webhookFailingMark = "配送失敗あり"

none :: String
none = "なし"

-- ---------------------------------------------------------------------------
-- 一般登録の状態と操作 (ui-spec A-2)
-- ---------------------------------------------------------------------------

gateStatusLabel :: RegistrationGateStatus -> String
gateStatusLabel = case _ of
  NOT_OPENED -> "未開放"
  OPEN -> "開放中"
  TEMPORARILY_SUSPENDED -> "一時停止中"
  AUTO_STOPPED -> "自動停止"
  ADMIN_STOPPED -> "停止中"
  OVERRIDE -> "強制開放中"

gateStatusTone :: RegistrationGateStatus -> Tone
gateStatusTone = case _ of
  NOT_OPENED -> Muted
  OPEN -> Success
  TEMPORARILY_SUSPENDED -> Warning
  AUTO_STOPPED -> Danger
  ADMIN_STOPPED -> Muted
  OVERRIDE -> Danger

buttonOpen :: String
buttonOpen = "開放"

buttonResume :: String
buttonResume = "再開"

buttonStop :: String
buttonStop = "停止"

buttonOverride :: String
buttonOverride = "強制開放…"

buttonRevokeOverride :: String
buttonRevokeOverride = "強制開放を解除"

protectionNotReady :: String
protectionNotReady = "保護が未準備"

-- | 登録の保護の適用証明 (E15d) が無い間に添える
enforcementNotApplied :: String
enforcementNotApplied = "保護が未適用"

-- ---------------------------------------------------------------------------
-- 強制開放の確認・警告帯 (ui-spec A-3 / A-4)
-- ---------------------------------------------------------------------------

overrideConfirmTitle :: String
overrideConfirmTitle = "強制開放しますか？"

overrideConfirmImpact :: String
overrideConfirmImpact = "解除するまで自動停止しません。"

overrideConfirmCheck :: String
overrideConfirmCheck = "リスクを理解しました"

buttonCancel :: String
buttonCancel = "キャンセル"

buttonConfirmOverride :: String
buttonConfirmOverride = "強制開放"

revokeConfirmTitle :: String
revokeConfirmTitle = "強制開放を解除しますか？"

revokeConfirmImpact :: String
revokeConfirmImpact = "一般登録は停止します。"

buttonConfirmRevoke :: String
buttonConfirmRevoke = "解除"

overrideStrip :: String
overrideStrip = "⚠ 強制開放中"

buttonStripRevoke :: String
buttonStripRevoke = "解除"

-- ---------------------------------------------------------------------------
-- 保護 (ui-spec A-5)
-- ---------------------------------------------------------------------------

protectionsHeading :: String
protectionsHeading = "保護"

protectionName :: RegistrationProtection -> String
protectionName = case _ of
  EMAIL -> "メール認証"
  BOT -> "BOT 保護"

-- | 未設定／設定エラー／未確認／準備済み／応答なし
protectionStatusLabel :: { enabled :: Boolean, status :: RegistrationProtectionStatus } -> String
protectionStatusLabel p
  | not p.enabled = "未設定"
  | otherwise = case p.status of
      CONFIGURATION_INVALID -> "設定エラー"
      UNVERIFIED -> "未確認"
      OPERATIONAL -> "準備済み"
      TEMPORARILY_UNAVAILABLE -> "応答なし"

protectionStatusTone :: { enabled :: Boolean, status :: RegistrationProtectionStatus } -> Tone
protectionStatusTone p
  | not p.enabled = Muted
  | otherwise = case p.status of
      CONFIGURATION_INVALID -> Danger
      UNVERIFIED -> Info
      OPERATIONAL -> Success
      TEMPORARILY_UNAVAILABLE -> Warning

-- | 短い理由 (設定エラー・応答なしの行だけ)。対応表に無い語彙は出さない
protectionReason :: String -> Maybe String
protectionReason = case _ of
  "disabled" -> Just "無効"
  "invalid_configuration" -> Just "設定が不正"
  "missing_secret" -> Just "シークレットが無い"
  "invalid_secret" -> Just "シークレットが不正"
  "smtp_auth_failed" -> Just "SMTP 認証失敗"
  "smtp_permanent_failure" -> Just "SMTP が拒否"
  "smtp_tls_failure" -> Just "TLS 失敗"
  "tls_failed" -> Just "TLS 失敗"
  "provider_rate_limited" -> Just "回数制限"
  "provider_server_error" -> Just "サーバーエラー"
  "timeout" -> Just "タイムアウト"
  "connect_failed" -> Just "接続失敗"
  "malformed_response" -> Just "応答が不正"
  "smtp_transient_failure" -> Just "SMTP 一時エラー"
  "hostname_mismatch" -> Just "ホスト名の不一致"
  "action_mismatch" -> Just "アクションの不一致"
  "recipient_rejected" -> Just "宛先が拒否"
  "recipient_deferred" -> Just "宛先が保留"
  _ -> Nothing

buttonVerify :: String
buttonVerify = "再検証"

-- ---------------------------------------------------------------------------
-- 通知 (ui-spec A-1)
-- ---------------------------------------------------------------------------

notificationsTitle :: String
notificationsTitle = "通知"

buttonMarkAllRead :: String
buttonMarkAllRead = "すべて既読にする"

-- | 通知の次のページを読む (51 件目以降)
buttonLoadMore :: String
buttonLoadMore = "さらに読み込む"

unreadMark :: String
unreadMark = "未読"

bellLabel :: Int -> String
bellLabel unread = if unread > 0 then "通知（未読 " <> show unread <> " 件）" else "通知"

-- | 通知の時点で設定済みかつ応答している保護の名前
names :: Array RegistrationProtection -> String
names list = if null list then "保護" else intercalate "・" (map protectionName list)

recovered :: { email :: ProtectionObservation, bot :: ProtectionObservation } -> Array RegistrationProtection
recovered obs = filter (\p -> healthy (observationOf obs p)) [ EMAIL, BOT ]
  where
  healthy o = o.configured && o.probe == HEALTHY

unresponsive :: { email :: ProtectionObservation, bot :: ProtectionObservation } -> Array RegistrationProtection
unresponsive obs = filter (\p -> failing (observationOf obs p)) [ EMAIL, BOT ]
  where
  failing o = o.configured && o.probe /= HEALTHY

observationOf :: { email :: ProtectionObservation, bot :: ProtectionObservation } -> RegistrationProtection -> ProtectionObservation
observationOf obs = case _ of
  EMAIL -> obs.email
  BOT -> obs.bot

-- | 通知・配送失敗の行のタイトル。観測が無い (配送記録) ときは保護名を出さない
eventTitle :: RegistrationGateEventKind -> Maybe { email :: ProtectionObservation, bot :: ProtectionObservation } -> String
eventTitle kind obs = case kind of
  OUTAGE_STARTED -> "一般登録を一時停止しました"
  OUTAGE_RECOVERED -> names (maybeList recovered) <> "が復旧しました"
  PROTECTION_DEGRADED -> names (maybeList unresponsive) <> "が応答しません"
  PROTECTION_LOST_STOPPED -> "一般登録を自動停止しました"
  ENFORCEMENT_LOST_STOPPED -> "一般登録を自動停止しました"
  ENFORCEMENT_RESTORED -> "保護の適用が復旧しました"
  OVERRIDE_STARTED -> "強制開放しました"
  OVERRIDE_REVOKED -> "強制開放を解除しました"
  where
  maybeList f = case obs of
    Just o -> f o
    Nothing -> []

eventTone :: RegistrationGateEventKind -> Tone
eventTone = case _ of
  OUTAGE_STARTED -> Warning
  OUTAGE_RECOVERED -> Success
  PROTECTION_DEGRADED -> Warning
  PROTECTION_LOST_STOPPED -> Danger
  ENFORCEMENT_LOST_STOPPED -> Danger
  ENFORCEMENT_RESTORED -> Success
  OVERRIDE_STARTED -> Danger
  OVERRIDE_REVOKED -> Info

-- ---------------------------------------------------------------------------
-- Webhook (ui-spec A-6)
-- ---------------------------------------------------------------------------

webhookDestinations :: String
webhookDestinations = "送信先"

webhookFailedHeading :: String
webhookFailedHeading = "配送失敗"

webhookHealthy :: String
webhookHealthy = "正常"

webhookFailing :: String
webhookFailing = "配送失敗"

webhookAdd :: String
webhookAdd = "Webhook を追加"

webhookModalTitle :: String
webhookModalTitle = "Webhook"

labelUrl :: String
labelUrl = "URL"

labelSecret :: String
labelSecret = "シークレット"

labelCategories :: String
labelCategories = "送る通知"

-- | 送る通知の名前 (保護が応答しなくなったことは「障害」で届く)
categoryLabel :: RegistrationWebhookCategory -> String
categoryLabel = case _ of
  Category.OUTAGE -> "障害"
  Category.RECOVERY -> "復旧"
  Category.AUTO_STOP -> "自動停止"
  Category.OVERRIDE -> "強制開放"

-- | 送信先が配送失敗になっている恒久的な理由の短い表示 (未解決の failed 配送だけのときは出さない)
endpointReason :: { failingReasons :: Array String, configIssue :: Maybe String } -> Maybe String
endpointReason e =
  if elem "secret_undecryptable" e.failingReasons then Just "シークレットを読めない"
  else if elem "config_invalid" e.failingReasons then e.configIssue >>= webhookIssue
  else Nothing

webhookIssue :: String -> Maybe String
webhookIssue = case _ of
  "invalid_url" -> Just "URL が不正"
  "unsupported_scheme" -> Just "URL が不正"
  "credentials_in_url" -> Just "URL が不正"
  "missing_host" -> Just "URL が不正"
  "missing_url" -> Just "URL が無い"
  "forbidden_destination" -> Just "宛先が許可されていない"
  "missing_secret" -> Just "シークレットが無い"
  "secret_too_short" -> Just "シークレットが短い"
  "secret_unreadable" -> Just "シークレットを読めない"
  "ambiguous_secret_source" -> Just "シークレットの指定が重複"
  _ -> Nothing

-- | 送信先の登録・更新・削除の拒否の 1 行表示 (API の固定コード)。語彙外・入力では直せないものは「この状態では操作できません」
webhookRejection :: Maybe String -> String
webhookRejection = case _ of
  Just "invalid_url" -> "URL が不正"
  Just "unsupported_scheme" -> "URL が不正"
  Just "credentials_in_url" -> "URL が不正"
  Just "fragment_in_url" -> "URL が不正"
  Just "missing_host" -> "URL が不正"
  Just "url_too_long" -> "URL が不正"
  Just "forbidden_destination" -> "宛先が許可されていない"
  Just "host_unresolvable" -> "接続失敗"
  Just "secret_required" -> "シークレットが無い"
  Just "secret_too_short" -> "シークレットが短い"
  Just "secret_too_long" -> "シークレットが長い"
  Just "duplicate_url" -> "登録済みの URL"
  Just "endpoint_limit_reached" -> "これ以上登録できません"
  Just "encryption_key_not_configured" -> "暗号鍵が未設定"
  _ -> "この状態では操作できません"

buttonTest :: String
buttonTest = "テスト"

buttonEdit :: String
buttonEdit = "編集"

buttonSave :: String
buttonSave = "保存"

buttonDelete :: String
buttonDelete = "削除"

buttonRetry :: String
buttonRetry = "再試行"

-- ---------------------------------------------------------------------------
-- 操作の結果
-- ---------------------------------------------------------------------------

toastOpened :: String
toastOpened = "開放しました"

toastStopped :: String
toastStopped = "停止しました"

toastOverrideRevoked :: String
toastOverrideRevoked = "強制開放を解除しました"

toastTestSent :: String
toastTestSent = "テスト送信しました"

toastTestFailed :: String
toastTestFailed = "テスト送信に失敗しました"

toastRetried :: String
toastRetried = "再送しました"

toastSaved :: String
toastSaved = "保存しました"

toastDeleted :: String
toastDeleted = "削除しました"

-- | 失敗の 1 行表示。競合・前提条件・一時障害・権限なしを別の文言にする
errorLine :: GateError -> String
errorLine = case _ of
  RevisionConflict -> "他の管理者が変更しました"
  PreconditionFailed -> "この状態では操作できません"
  NotFound -> "この状態では操作できません"
  WebhookNotConfigured -> "この状態では操作できません"
  WebhookRejected reason -> webhookRejection reason
  TemporarilyUnavailable -> "接続できません"
  Unexpected -> "接続できません"
  Forbidden -> "権限がありません"
  Unauthenticated -> "権限がありません"

-- | 一時障害は［再試行］で取り直せる。競合・前提条件は最新の状態を自動で取り直す
errorRetryable :: GateError -> Boolean
errorRetryable = case _ of
  TemporarilyUnavailable -> true
  Unexpected -> true
  _ -> false
