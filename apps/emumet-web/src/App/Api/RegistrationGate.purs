-- | 登録ゲート管理画面の GraphQL 呼び出し (BFF /graphql)。
-- | エラーは extensions.code で GateError に分類する (競合・前提条件・一時障害・権限なしを混同しない)。
module App.Api.RegistrationGate
  ( fetchViewerIsAdmin
  , fetchGate
  , fetchProtections
  , fetchWebhook
  , fetchNotifications
  , openGate
  , closeGate
  , enableOverride
  , revokeOverride
  , markRead
  , markAllRead
  , verifyProtection
  , testWebhook
  , retryDelivery
  ) where

import Prelude

import App.Admin.Types (Delivery, Gate, GateError(..), Notification, Protection, Webhook)
import Data.Argonaut.Core (Json)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, (.:))
import Data.Array (head, mapMaybe, null)
import Data.Either (Either(..), hush)
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Effect.Aff (Aff, Error, try)
import Generated.Schema.Gql (Mutation, Query)
import Generated.Schema.Gql.Enum.RegistrationAdminState (RegistrationAdminState(..))
import Generated.Schema.Gql.Enum.RegistrationGateEventKind (RegistrationGateEventKind)
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus)
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection)
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus)
import Generated.Schema.Gql.Enum.RegistrationProbeStatus (RegistrationProbeStatus)
import Generated.Schema.Gql.Enum.RegistrationWebhookConfiguration (RegistrationWebhookConfiguration)
import Generated.Schema.Gql.Enum.RegistrationWebhookDeliveryStatus (RegistrationWebhookDeliveryStatus(..))
import GraphQL.Client.Args (Args(..))
import GraphQL.Client.BaseClients.Affjax.Web (AffjaxWebClient(..))
import GraphQL.Client.ID (ID(..))
import GraphQL.Client.Query (mutationJson, queryJson)
import GraphQL.Client.Types (Client(..), GqlResJson(..))
import Type.Data.List (Nil')
import Type.Proxy (Proxy)

queryClient :: Client AffjaxWebClient { directives :: Proxy Nil', query :: Query | () }
queryClient = Client (AffjaxWebClient "/graphql" [])

mutationClient :: Client AffjaxWebClient { directives :: Proxy Nil', mutation :: Mutation | () }
mutationClient = Client (AffjaxWebClient "/graphql" [])

-- ---------------------------------------------------------------------------
-- 応答の分類
-- ---------------------------------------------------------------------------

errorFromCode :: Maybe String -> GateError
errorFromCode = case _ of
  Just "UNAUTHENTICATED" -> Unauthenticated
  Just "FORBIDDEN" -> Forbidden
  Just "REVISION_CONFLICT" -> RevisionConflict
  Just "PRECONDITION_FAILED" -> PreconditionFailed
  Just "TEMPORARILY_UNAVAILABLE" -> TemporarilyUnavailable
  Just "NOT_FOUND" -> NotFound
  Just "WEBHOOK_NOT_CONFIGURED" -> WebhookNotConfigured
  _ -> Unexpected

firstErrorCode :: Array Json -> Maybe String
firstErrorCode errs = do
  err <- head errs
  obj <- hush (decodeJson err)
  extensions <- hush (obj .: "extensions")
  hush (extensions .: "code")

-- | GraphQL 応答を、errors があればその分類、無ければ data の decode 結果にする
classify :: forall schema query res a. DecodeJson a => Either Error (GqlResJson schema query res) -> Either GateError a
classify = case _ of
  -- BFF に届かない (ネットワーク断・タイムアウト) は一時障害として扱う
  Left _ -> Left TemporarilyUnavailable
  Right (GqlResJson json) -> case hush (decodeJson json) of
    Nothing -> Left Unexpected
    Just obj -> case hush (obj .: "errors") :: Maybe (Array Json) of
      Just errs | not (null errs) -> Left (errorFromCode (firstErrorCode errs))
      _ -> case hush (obj .: "data") >>= (hush <<< decodeJson) of
        Just a -> Right a
        Nothing -> Left Unexpected

-- ---------------------------------------------------------------------------
-- 選択するフィールドと変換
-- ---------------------------------------------------------------------------

gateSelection =
  { revision: unit
  , status: unit
  , minimumMet: unit
  , adminState: unit
  , override: { active: unit }
  , observation: { enforcementVerified: unit }
  }

type RawGate =
  { revision :: Int
  , status :: RegistrationGateStatus
  , minimumMet :: Boolean
  , adminState :: RegistrationAdminState
  , override :: { active :: Boolean }
  , observation :: { enforcementVerified :: Boolean }
  }

toGate :: RawGate -> Gate
toGate raw =
  { revision: raw.revision
  , status: raw.status
  , minimumMet: raw.minimumMet
  , adminOpen: raw.adminState == OPEN
  , overrideActive: raw.override.active
  , enforcementVerified: raw.observation.enforcementVerified
  }

protectionSelection =
  { protection: unit, enabled: unit, status: unit, reason: unit, checkedAt: unit }

type RawProtection =
  { protection :: RegistrationProtection
  , enabled :: Boolean
  , status :: RegistrationProtectionStatus
  , reason :: String
  , checkedAt :: Maybe String
  }

type RawObservation = { configured :: Boolean, probe :: RegistrationProbeStatus }

type RawNotification =
  { id :: ID
  , kind :: RegistrationGateEventKind
  , read :: Boolean
  , createdAt :: String
  , observation :: { email :: RawObservation, bot :: RawObservation }
  }

toNotification :: RawNotification -> Notification
toNotification raw =
  { id: unwrap raw.id
  , kind: raw.kind
  , read: raw.read
  , createdAt: raw.createdAt
  , email: raw.observation.email
  , bot: raw.observation.bot
  }

type RawDelivery =
  { eventId :: ID
  , eventType :: RegistrationGateEventKind
  , status :: RegistrationWebhookDeliveryStatus
  , createdAt :: String
  , lastAttemptAt :: Maybe String
  }

type RawWebhook =
  { configuration :: RegistrationWebhookConfiguration
  , issue :: Maybe String
  , destinationHost :: Maybe String
  , counts :: { failed :: Int }
  , recentDeliveries :: Array RawDelivery
  }

toWebhook :: RawWebhook -> Webhook
toWebhook raw =
  { configuration: raw.configuration
  , issue: raw.issue
  , destinationHost: raw.destinationHost
  , failedCount: raw.counts.failed
  -- 表示するのは失敗した配送だけ (成功した配送の履歴は出さない)
  , deliveries: mapMaybe failed raw.recentDeliveries
  }
  where
  failed :: RawDelivery -> Maybe Delivery
  failed d =
    if d.status == FAILED then Just { eventId: unwrap d.eventId, eventType: d.eventType, status: d.status, createdAt: d.createdAt, lastAttemptAt: d.lastAttemptAt }
    else Nothing

-- ---------------------------------------------------------------------------
-- Query
-- ---------------------------------------------------------------------------

fetchViewerIsAdmin :: Aff (Either GateError Boolean)
fetchViewerIsAdmin = do
  result <- try $ queryJson identity queryClient "AdminViewer" { viewer: { isAdmin: unit } }
  pure $ map (\(r :: { viewer :: { isAdmin :: Boolean } }) -> r.viewer.isAdmin) (classify result)

fetchGate :: Aff (Either GateError Gate)
fetchGate = do
  result <- try $ queryJson identity queryClient "RegistrationGate" { registrationGate: gateSelection }
  pure $ map (\(r :: { registrationGate :: RawGate }) -> toGate r.registrationGate) (classify result)

fetchProtections :: Aff (Either GateError (Array Protection))
fetchProtections = do
  result <- try $ queryJson identity queryClient "RegistrationProtections" { registrationProtections: protectionSelection }
  pure $ map (\(r :: { registrationProtections :: Array RawProtection }) -> r.registrationProtections) (classify result)

fetchWebhook :: Aff (Either GateError Webhook)
fetchWebhook = do
  result <- try $ queryJson identity queryClient "RegistrationWebhook"
    { registrationWebhook:
        { configuration: unit
        , issue: unit
        , destinationHost: unit
        , counts: { failed: unit }
        , recentDeliveries: { eventId: unit, eventType: unit, status: unit, createdAt: unit, lastAttemptAt: unit }
        }
    }
  pure $ map (\(r :: { registrationWebhook :: RawWebhook }) -> toWebhook r.registrationWebhook) (classify result)

fetchNotifications :: Aff (Either GateError { items :: Array Notification, unread :: Int })
fetchNotifications = do
  result <- try $ queryJson identity queryClient "RegistrationGateNotifications"
    { registrationGateNotifications:
        { limit: 50 } `Args`
          { unreadCount: unit
          , notifications:
              { id: unit
              , kind: unit
              , read: unit
              , createdAt: unit
              , observation: { email: { configured: unit, probe: unit }, bot: { configured: unit, probe: unit } }
              }
          }
    }
  pure $ map
    ( \(r :: { registrationGateNotifications :: { unreadCount :: Int, notifications :: Array RawNotification } }) ->
        { items: map toNotification r.registrationGateNotifications.notifications, unread: r.registrationGateNotifications.unreadCount }
    )
    (classify result)

-- ---------------------------------------------------------------------------
-- Mutation
-- ---------------------------------------------------------------------------

openGate :: Int -> Aff (Either GateError Gate)
openGate revision = do
  result <- try $ mutationJson identity mutationClient "OpenRegistrationGate"
    { openRegistrationGate: { revision } `Args` gateSelection }
  pure $ map (\(r :: { openRegistrationGate :: RawGate }) -> toGate r.openRegistrationGate) (classify result)

closeGate :: Int -> Aff (Either GateError Gate)
closeGate revision = do
  result <- try $ mutationJson identity mutationClient "CloseRegistrationGate"
    { closeRegistrationGate: { revision } `Args` gateSelection }
  pure $ map (\(r :: { closeRegistrationGate :: RawGate }) -> toGate r.closeRegistrationGate) (classify result)

-- | 確認モーダルで「リスクを理解しました」をチェックしたときだけ呼ぶ (acknowledgeWarning は常に true)
enableOverride :: Int -> Aff (Either GateError Gate)
enableOverride revision = do
  result <- try $ mutationJson identity mutationClient "EnableRegistrationGateOverride"
    { enableRegistrationGateOverride: { revision, acknowledgeWarning: true } `Args` gateSelection }
  pure $ map (\(r :: { enableRegistrationGateOverride :: RawGate }) -> toGate r.enableRegistrationGateOverride) (classify result)

revokeOverride :: Int -> Aff (Either GateError Gate)
revokeOverride revision = do
  result <- try $ mutationJson identity mutationClient "RevokeRegistrationGateOverride"
    { revokeRegistrationGateOverride: { revision } `Args` gateSelection }
  pure $ map (\(r :: { revokeRegistrationGateOverride :: RawGate }) -> toGate r.revokeRegistrationGateOverride) (classify result)

markRead :: Array String -> Aff (Either GateError Int)
markRead ids = do
  result <- try $ mutationJson identity mutationClient "MarkRegistrationGateNotificationsRead"
    { markRegistrationGateNotificationsRead: { eventIds: map ID ids } `Args` unit }
  pure $ map (\(r :: { markRegistrationGateNotificationsRead :: Int }) -> r.markRegistrationGateNotificationsRead) (classify result)

markAllRead :: Aff (Either GateError Int)
markAllRead = do
  result <- try $ mutationJson identity mutationClient "MarkAllRegistrationGateNotificationsRead"
    { markAllRegistrationGateNotificationsRead: unit }
  pure $ map (\(r :: { markAllRegistrationGateNotificationsRead :: Int }) -> r.markAllRegistrationGateNotificationsRead) (classify result)

verifyProtection :: RegistrationProtection -> Aff (Either GateError Protection)
verifyProtection protection = do
  result <- try $ mutationJson identity mutationClient "VerifyRegistrationProtection"
    { verifyRegistrationProtection: { protection } `Args` { readiness: protectionSelection } }
  pure $ map (\(r :: { verifyRegistrationProtection :: { readiness :: RawProtection } }) -> r.verifyRegistrationProtection.readiness) (classify result)

-- | 戻り値は受信側が 2xx を返したか
testWebhook :: Aff (Either GateError Boolean)
testWebhook = do
  result <- try $ mutationJson identity mutationClient "SendRegistrationWebhookTest"
    { sendRegistrationWebhookTest: { delivered: unit } }
  pure $ map (\(r :: { sendRegistrationWebhookTest :: { delivered :: Boolean } }) -> r.sendRegistrationWebhookTest.delivered) (classify result)

retryDelivery :: String -> Aff (Either GateError Int)
retryDelivery eventId = do
  result <- try $ mutationJson identity mutationClient "RetryRegistrationWebhook"
    { retryRegistrationWebhook: { eventId: ID eventId } `Args` unit }
  pure $ case classify result of
    Right (r :: { retryRegistrationWebhook :: Int }) | r.retryRegistrationWebhook > 0 -> Right r.retryRegistrationWebhook
    Right _ -> Left NotFound
    Left err -> Left err
