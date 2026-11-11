-- | 登録ゲート管理画面の GraphQL 呼び出し (BFF /graphql)。
-- | エラーは extensions.code で GateError に分類する (競合・前提条件・一時障害・権限なしを混同しない)。
module App.Api.RegistrationGate
  ( fetchViewerIsAdmin
  , fetchGate
  , fetchProtections
  , fetchWebhook
  , fetchFailures
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
  , createEndpoint
  , updateEndpoint
  , deleteEndpoint
  ) where

import Prelude

import App.Admin.Types (Failure, FailurePage, Gate, GateError(..), Notification, NotificationPage, Protection, Webhook)
import Data.Argonaut.Core (Json)
import Data.Argonaut.Decode (class DecodeJson, decodeJson, (.:))
import Data.Array (head, null)
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
import Generated.Schema.Gql.Enum.RegistrationWebhookCategory (RegistrationWebhookCategory)
import Generated.Schema.Gql.Enum.RegistrationWebhookEndpointStatus (RegistrationWebhookEndpointStatus)
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

errorFromCode :: Maybe String -> Maybe String -> GateError
errorFromCode code reason = case code of
  Just "WEBHOOK_ENDPOINT_REJECTED" -> WebhookRejected reason
  Just "UNAUTHENTICATED" -> Unauthenticated
  Just "FORBIDDEN" -> Forbidden
  Just "REVISION_CONFLICT" -> RevisionConflict
  Just "PRECONDITION_FAILED" -> PreconditionFailed
  Just "TEMPORARILY_UNAVAILABLE" -> TemporarilyUnavailable
  Just "NOT_FOUND" -> NotFound
  Just "WEBHOOK_NOT_CONFIGURED" -> WebhookNotConfigured
  _ -> Unexpected

-- | 最初のエラーの extensions.code と extensions.reason (送信先の拒否理由。他のエラーには無い)
firstErrorCode :: Array Json -> { code :: Maybe String, reason :: Maybe String }
firstErrorCode errs = { code: field "code", reason: field "reason" }
  where
  field name = do
    err <- head errs
    obj <- hush (decodeJson err)
    extensions <- hush (obj .: "extensions")
    hush (extensions .: name)

-- | GraphQL 応答を、errors があればその分類、無ければ data の decode 結果にする
classify :: forall schema query res a. DecodeJson a => Either Error (GqlResJson schema query res) -> Either GateError a
classify = case _ of
  -- BFF に届かない (ネットワーク断・タイムアウト) は一時障害として扱う
  Left _ -> Left TemporarilyUnavailable
  Right (GqlResJson json) -> case hush (decodeJson json) of
    Nothing -> Left Unexpected
    Just obj -> case hush (obj .: "errors") :: Maybe (Array Json) of
      Just errs | not (null errs) ->
        let
          first = firstErrorCode errs
        in
          Left (errorFromCode first.code first.reason)
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

type RawEndpoint =
  { id :: ID
  , maskedUrl :: String
  , categories :: Array RegistrationWebhookCategory
  , status :: RegistrationWebhookEndpointStatus
  , failingReasons :: Array String
  , configIssue :: Maybe String
  , secretConfigured :: Boolean
  , editable :: Boolean
  , revision :: Maybe Int
  }

type RawWebhook = { endpoints :: Array RawEndpoint, hasFailedDeliveries :: Boolean }

toWebhook :: RawWebhook -> Webhook
toWebhook raw =
  { endpoints: map (\e -> e { id = unwrap e.id }) raw.endpoints
  , hasFailedDeliveries: raw.hasFailedDeliveries
  }

type RawFailure = { endpointId :: ID, eventId :: ID, eventType :: RegistrationGateEventKind, failedAt :: String }

toFailure :: RawFailure -> Failure
toFailure raw = { endpointId: unwrap raw.endpointId, eventId: unwrap raw.eventId, eventType: raw.eventType, failedAt: raw.failedAt }

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
  result <- try $ queryJson identity queryClient "RegistrationWebhookEndpoints"
    { registrationWebhookEndpoints:
        { hasFailedDeliveries: unit
        , endpoints: { id: unit, maskedUrl: unit, categories: unit, status: unit, failingReasons: unit, configIssue: unit, secretConfigured: unit, editable: unit, revision: unit }
        }
    }
  pure $ map (\(r :: { registrationWebhookEndpoints :: RawWebhook }) -> toWebhook r.registrationWebhookEndpoints) (classify result)

failureSelection =
  { nextCursor: unit
  , items: { endpointId: unit, eventId: unit, eventType: unit, failedAt: unit }
  }

type RawFailurePage = { registrationWebhookFailures :: { nextCursor :: Maybe String, items :: Array RawFailure } }

-- | 配送失敗の 1 ページ (新しい順、50 件)。before は前のページの nextCursor
fetchFailures :: Maybe String -> Aff (Either GateError FailurePage)
fetchFailures before = do
  (result :: Either GateError RawFailurePage) <- case before of
    Nothing -> classify <$> try (queryJson identity queryClient "RegistrationWebhookFailures" { registrationWebhookFailures: { limit: 50 } `Args` failureSelection })
    Just cursor -> classify <$> try (queryJson identity queryClient "RegistrationWebhookFailuresBefore" { registrationWebhookFailures: { limit: 50, before: cursor } `Args` failureSelection })
  pure $ map
    ( \(r :: RawFailurePage) ->
        { items: map toFailure r.registrationWebhookFailures.items, nextCursor: r.registrationWebhookFailures.nextCursor }
    )
    result

notificationSelection =
  { unreadCount: unit
  , nextCursor: unit
  , notifications:
      { id: unit
      , kind: unit
      , read: unit
      , createdAt: unit
      , observation: { email: { configured: unit, probe: unit }, bot: { configured: unit, probe: unit } }
      }
  }

type RawNotificationPage = { registrationGateNotifications :: { unreadCount :: Int, nextCursor :: Maybe String, notifications :: Array RawNotification } }

-- | 通知の 1 ページ (新しい順、50 件)。before は前のページの nextCursor
fetchNotifications :: Maybe String -> Aff (Either GateError NotificationPage)
fetchNotifications before = do
  (result :: Either GateError RawNotificationPage) <- case before of
    Nothing -> classify <$> try (queryJson identity queryClient "RegistrationGateNotifications" { registrationGateNotifications: { limit: 50 } `Args` notificationSelection })
    Just cursor -> classify <$> try (queryJson identity queryClient "RegistrationGateNotificationsBefore" { registrationGateNotifications: { limit: 50, before: cursor } `Args` notificationSelection })
  pure $ map
    ( \(r :: RawNotificationPage) ->
        { items: map toNotification r.registrationGateNotifications.notifications
        , unread: r.registrationGateNotifications.unreadCount
        , nextCursor: r.registrationGateNotifications.nextCursor
        }
    )
    result

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
testWebhook :: String -> Aff (Either GateError Boolean)
testWebhook endpointId = do
  result <- try $ mutationJson identity mutationClient "SendRegistrationWebhookTest"
    { sendRegistrationWebhookTest: { endpointId: ID endpointId } `Args` { delivered: unit } }
  pure $ map (\(r :: { sendRegistrationWebhookTest :: { delivered :: Boolean } }) -> r.sendRegistrationWebhookTest.delivered) (classify result)

-- | 配送失敗を 1 件だけ再キューする (送信先 ID と event ID の組)
retryDelivery :: String -> String -> Aff (Either GateError Int)
retryDelivery endpointId eventId = do
  result <- try $ mutationJson identity mutationClient "RetryRegistrationWebhook"
    { retryRegistrationWebhook: { endpointId: ID endpointId, eventId: ID eventId } `Args` unit }
  pure $ case classify result of
    Right (r :: { retryRegistrationWebhook :: Int }) | r.retryRegistrationWebhook > 0 -> Right r.retryRegistrationWebhook
    Right _ -> Left NotFound
    Left err -> Left err

createEndpoint :: { url :: String, secret :: String, categories :: Array RegistrationWebhookCategory } -> Aff (Either GateError Unit)
createEndpoint input = do
  result <- try $ mutationJson identity mutationClient "CreateRegistrationWebhookEndpoint"
    { createRegistrationWebhookEndpoint: { input } `Args` { id: unit } }
  pure $ map (\(_ :: { createRegistrationWebhookEndpoint :: { id :: ID } }) -> unit) (classify result)

-- | Nothing の項目は送らない (= 変更しない)。URL・シークレットは入力したときだけ渡す
updateEndpoint
  :: String
  -> { revision :: Int, url :: Maybe String, secret :: Maybe String, categories :: Maybe (Array RegistrationWebhookCategory) }
  -> Aff (Either GateError Unit)
updateEndpoint endpointId input = do
  result <- try $ mutationJson identity mutationClient "UpdateRegistrationWebhookEndpoint"
    { updateRegistrationWebhookEndpoint: { endpointId: ID endpointId, input } `Args` { id: unit } }
  pure $ map (\(_ :: { updateRegistrationWebhookEndpoint :: { id :: ID } }) -> unit) (classify result)

deleteEndpoint :: String -> Int -> Aff (Either GateError Unit)
deleteEndpoint endpointId revision = do
  result <- try $ mutationJson identity mutationClient "DeleteRegistrationWebhookEndpoint"
    { deleteRegistrationWebhookEndpoint: { endpointId: ID endpointId, revision } `Args` unit }
  pure $ map (\(_ :: { deleteRegistrationWebhookEndpoint :: Boolean }) -> unit) (classify result)
