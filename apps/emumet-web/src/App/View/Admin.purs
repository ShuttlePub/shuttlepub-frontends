-- | 登録ゲート管理画面 (ui-spec「モック A v5」)。画面には状態と操作だけを置き、仕組みの説明は (?) からヘルプへ回す。
module App.View.Admin
  ( registrationPage
  , webhookPage
  , overrideStrip
  , bellItem
  , bellBackdrop
  ) where

import Prelude

import App.Admin.Text (Tone)
import App.Admin.Text as Text
import App.Admin.Time (eventKey, formatEventTime, trapFocus)
import App.Admin.Types (AdminModal(..), AdminModel, AdminMsg(..), Delivery, Gate, GateCommand(..), Loadable(..), Notification, Protection, Webhook)
import App.Message (Message(..))
import App.Model (Model)
import App.Route (Route(..), routeCodec)
import Data.Array (elem, null)
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Effect (Effect)
import Flame (Html)
import Flame.Types (NodeData)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.RegistrationGateStatus (RegistrationGateStatus(..))
import Generated.Schema.Gql.Enum.RegistrationProtection (RegistrationProtection(..))
import Generated.Schema.Gql.Enum.RegistrationProtectionStatus (RegistrationProtectionStatus(..))
import Generated.Schema.Gql.Enum.RegistrationWebhookConfiguration (RegistrationWebhookConfiguration(..))
import Routing.Duplex (print)
import ShuttlePub.UI.NotFound as NotFound
import ShuttlePub.UI.Theme as T
import Web.Event.Event (Event, preventDefault)

-- ---------------------------------------------------------------------------
-- 部品 (余白は ui-spec の表: desktop / mobile)
-- ---------------------------------------------------------------------------

admin :: AdminMsg -> Message
admin = Admin

attr :: String -> String -> NodeData Message
attr = HA.createAttribute

btnBase :: String
btnBase = "inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap border transition-colors disabled:opacity-45 disabled:cursor-not-allowed " <> T.roundedTheme

btnSmall :: String
btnSmall = btnBase <> " px-2.5 py-1 text-xs"

btnNormal :: String
btnNormal = btnBase <> " px-3 sm:px-3.5 py-2 text-sm"

primary :: String
primary = "bg-accent text-bg-secondary border-transparent hover:bg-accent-hover"

outline :: String
outline = "bg-transparent text-accent border-border hover:bg-bg-primary"

danger :: String
danger = "bg-error text-bg-secondary border-transparent"

dangerGhost :: String
dangerGhost = "bg-transparent text-error border-error/50 hover:bg-error/10"

button :: String -> Boolean -> Message -> Array (Html Message) -> Html Message
button classes disabled message children =
  HE.button [ HA.type' "button", HA.class' classes, HA.disabled disabled, HA.onClick message ] children

-- | visual / E2E が文言に依存せず操作できるよう data-testid を付けたボタン
testButton :: String -> String -> Boolean -> Message -> Array (Html Message) -> Html Message
testButton testId classes disabled message children =
  HE.button [ HA.type' "button", HA.id testId, attr "data-testid" testId, HA.class' classes, HA.disabled disabled, HA.onClick message ] children

spinner :: Html Message
spinner = HE.span [ HA.class' "inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin", attr "aria-hidden" "true" ] []

chip :: Tone -> String -> String -> Html Message
chip tone size label =
  HE.span [ HA.class' ("inline-flex items-center gap-1 font-semibold whitespace-nowrap border border-current " <> T.roundedTheme <> " " <> size <> " " <> Text.toneClass tone) ]
    [ HE.span [ HA.class' "w-2 h-2 rounded-full bg-current shrink-0" ] []
    , HE.text label
    ]

smallChip :: Tone -> String -> Html Message
smallChip tone = chip tone "px-2 py-0.5 text-xs"

sectionHeading :: Array (Html Message) -> Html Message
sectionHeading = HE.h2 [ HA.class' ("flex items-center gap-2 mb-2 text-[15px] font-semibold " <> T.textPrimary) ]

listSurface :: Array (Html Message) -> Html Message
listSurface = HE.div [ HA.class' (T.surface <> " overflow-hidden") ]

rowClass :: String
rowClass = "flex flex-wrap items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-sm border-b border-border last:border-b-0"

timeText :: String -> Html Message
timeText iso = HE.span [ HA.class' ("text-xs whitespace-nowrap " <> T.textMuted) ] [ HE.text (formatEventTime iso) ]

spaLink :: Route -> Array (NodeData Message) -> Array (Html Message) -> Html Message
spaLink route attrs children =
  HE.a ([ HA.href (print routeCodec route), HA.createRawEvent "click" handler ] <> attrs) children
  where
  handler :: Event -> Effect (Maybe Message)
  handler event = do
    preventDefault event
    pure (Just (Navigate route))

-- ---------------------------------------------------------------------------
-- ページの枠: 見出し・タブ・失敗の 1 行・モーダル・トースト
-- ---------------------------------------------------------------------------

page :: Model -> Route -> Array (Html Message) -> Html Message
page model route body = case model.admin.isAdmin of
  Just true ->
    HE.div [ attr "data-testid" "admin-page", HA.class' "space-y-2.5 sm:space-y-4" ]
      ([ header model.admin route, errorLine model.admin ] <> body <> [ modal model.admin, toast model.admin ])
  -- 管理者でなければ管理画面は存在しないものとして扱う (導線も出さない)
  Just false -> NotFound.notFound
  -- 管理者か分かるまでは何も出さない
  Nothing -> HE.div [ HA.class' "hidden" ] []

header :: AdminModel -> Route -> Html Message
header model route =
  HE.div_
    [ HE.h1 [ HA.class' ("text-xl leading-7 sm:text-2xl sm:leading-8 font-bold tracking-tight " <> T.textHeading) ] [ HE.text Text.adminTitle ]
    , HE.nav [ attr "aria-label" Text.adminTitle ]
        [ HE.div [ HA.class' "mt-2 flex gap-1 border-b border-border overflow-x-auto" ]
            [ tab AdminRegistration [ HE.text Text.tabRegistration ]
            , tab AdminWebhook ([ HE.text Text.tabWebhook ] <> failingMark)
            ]
        ]
    ]
  where
  tab target children =
    spaLink target
      ( [ HA.class' ("inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px " <> if target == route then "text-accent border-accent" else "text-text-secondary border-transparent hover:text-accent") ]
          <> (if target == route then [ attr "aria-current" "page" ] else [])
      )
      children
  failingMark = case model.webhook of
    Loaded webhook | webhook.failedCount > 0 ->
      [ HE.span [ HA.class' (Text.toneClass Text.Warning), attr "aria-label" Text.webhookFailingMark, HA.title Text.webhookFailingMark ] [ HE.text "●" ] ]
    _ -> []

errorLine :: AdminModel -> Html Message
errorLine model = case model.error of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just err ->
    HE.div
      [ attr "role" "alert"
      , HA.class' ("flex items-center gap-3 px-3 py-2 text-sm border " <> T.roundedTheme <> " " <> T.textError <> " " <> T.borderTheme <> " bg-red-500/10")
      ]
      ( [ HE.span [ HA.class' "flex-1" ] [ HE.text (Text.errorLine err) ] ]
          <> (if Text.errorRetryable err then [ button (btnSmall <> " " <> outline) false (admin RefreshAdmin) [ HE.text Text.buttonRetry ] ] else [])
      )

modal :: AdminModel -> Html Message
modal model = case model.modal of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just which ->
    HE.div [ HA.class' "fixed inset-0 z-30 flex items-start justify-center px-2 py-3 sm:px-4 sm:pt-16 sm:pb-4" ]
      [ HE.div [ HA.class' "absolute inset-0 bg-black/60", attr "aria-hidden" "true", HA.onClick (admin CloseModal) ] []
      , HE.div
          [ attr "role" "dialog"
          , attr "aria-modal" "true"
          , attr "aria-labelledby" "admin-modal-title"
          -- Tab / Shift+Tab をモーダルの中で循環させる (背面の画面へフォーカスを逃がさない)。
          -- Flame は要素のハンドラで処理したイベントを document へ伝えないので、Esc もここで閉じる
          , HA.createRawEvent "keydown" \event -> do
              trapFocus event
              pure (if eventKey event == "Escape" then Just (admin CloseModal) else Nothing)
          , HA.class' (T.surface <> " relative w-full max-w-lg p-4 sm:p-5")
          ]
          (body which)
      ]
  where
  title text = HE.h2 [ HA.id "admin-modal-title", HA.class' ("mb-2 text-lg font-semibold " <> T.textHeading) ] [ HE.text text ]
  impact text = HE.p [ HA.class' ("mb-3 text-sm " <> T.textSecondary) ] [ HE.text text ]
  buttons = HE.div [ HA.class' "mt-4 flex justify-end gap-2 [&>button]:flex-1 sm:[&>button]:flex-none" ]
  body = case _ of
    OverrideModal ->
      [ title Text.overrideConfirmTitle
      , impact Text.overrideConfirmImpact
      , HE.label [ HA.class' ("flex items-start gap-2.5 text-sm leading-normal cursor-pointer " <> T.textSecondary) ]
          [ HE.input
              [ HA.id "override-ack"
              , HA.type' "checkbox"
              , HA.class' "w-4 h-4 mt-0.5 accent-accent shrink-0"
              , HA.checked model.overrideAck
              , HA.onCheck (admin <<< SetOverrideAck)
              ]
          , HE.text Text.overrideConfirmCheck
          ]
      , buttons
          [ button (btnNormal <> " " <> outline) false (admin CloseModal) [ HE.text Text.buttonCancel ]
          , testButton "override-confirm" (btnNormal <> " " <> danger) (not model.overrideAck || model.pending) (admin ConfirmOverride) [ HE.text Text.buttonConfirmOverride ]
          ]
      ]
    RevokeModal ->
      [ title Text.revokeConfirmTitle
      , impact Text.revokeConfirmImpact
      , buttons
          [ HE.button [ HA.id "revoke-cancel", HA.type' "button", HA.class' (btnNormal <> " " <> outline), HA.onClick (admin CloseModal) ] [ HE.text Text.buttonCancel ]
          , testButton "revoke-confirm" (btnNormal <> " " <> primary) model.pending (admin ConfirmRevoke) [ HE.text Text.buttonConfirmRevoke ]
          ]
      ]

toast :: AdminModel -> Html Message
toast model = case model.toast of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just t ->
    HE.div
      [ attr "role" "status"
      , HA.class' ("fixed left-1/2 bottom-5 -translate-x-1/2 z-40 max-w-[90%] px-4 py-2.5 text-sm border shadow-lg bg-bg-primary " <> T.roundedTheme <> " " <> T.borderTheme <> " " <> T.textHeading)
      ]
      [ HE.text t.text ]

-- ---------------------------------------------------------------------------
-- 「一般登録」タブ (ui-spec A-2 / A-5)
-- ---------------------------------------------------------------------------

registrationPage :: Model -> Html Message
registrationPage model =
  page model AdminRegistration
    [ case model.admin.gate of
        Loaded gate -> gatePanel model.admin gate
        _ -> HE.div [ HA.class' "hidden" ] []
    , protectionsSection model.admin
    ]

gatePanel :: AdminModel -> Gate -> Html Message
gatePanel model gate =
  HE.section
    [ attr "aria-label" Text.tabRegistration
    , attr "data-testid" "registration-gate"
    , attr "data-status" (show gate.status)
    , HA.class' (T.surface <> " flex flex-wrap items-center gap-2 p-3 sm:px-4")
    ]
    ( [ HE.span [ HA.class' ("text-base font-semibold " <> T.textHeading) ] [ HE.text Text.tabRegistration ]
      , chip (Text.gateStatusTone gate.status) "px-2.5 py-[3px] text-[13px]" (Text.gateStatusLabel gate.status)
      , HE.span [ HA.class' "flex-1" ] []
      ]
        <> actions
    )
  where
  pending = model.pending
  -- 開放・再開の前提: 登録の保護の適用証明 (E15d) と最低条件 (メール認証か BOT 保護が準備済み)
  enforcementMissing = not gate.enforcementVerified
  minimumMissing = not gate.minimumMet
  why text = HE.span [ HA.class' ("text-xs " <> T.textMuted) ] [ HE.text text ]
  openLike label =
    ( if enforcementMissing then [ why Text.enforcementNotApplied ]
      else if minimumMissing then [ why Text.protectionNotReady ]
      else []
    )
      <> [ testButton "gate-open" (btnSmall <> " " <> primary) (pending || enforcementMissing || minimumMissing) (admin (RunCommand OpenGate)) [ HE.text label ] ]
      <>
        ( if minimumMissing || enforcementMissing then [ testButton "gate-override" (btnSmall <> " " <> dangerGhost) (pending || enforcementMissing) (admin (OpenOverrideModal "gate-override")) [ HE.text Text.buttonOverride ] ]
          else []
        )
  stop = [ testButton "gate-stop" (btnSmall <> " " <> outline) pending (admin (RunCommand CloseGate)) [ HE.text Text.buttonStop ] ]
  actions = case gate.status of
    NOT_OPENED -> openLike Text.buttonOpen
    AUTO_STOPPED -> openLike Text.buttonResume
    ADMIN_STOPPED -> openLike Text.buttonResume
    OPEN -> stop
    -- 一時停止中は復旧すると自動で再開するので［再開］は出さない
    TEMPORARILY_SUSPENDED -> stop
    OVERRIDE -> [ testButton "gate-revoke" (btnSmall <> " " <> outline) pending (admin (RequestRevoke "gate-revoke")) [ HE.text Text.buttonRevokeOverride ] ]

protectionsSection :: AdminModel -> Html Message
protectionsSection model = case model.protections of
  Loaded list ->
    HE.section_
      [ sectionHeading [ HE.text Text.protectionsHeading ]
      , listSurface (map (protectionRow model) list)
      ]
  _ -> HE.div [ HA.class' "hidden" ] []

protectionRow :: AdminModel -> Protection -> Html Message
protectionRow model p =
  HE.div [ HA.class' rowClass, attr "data-testid" ("protection-" <> protectionKey p.protection) ]
    ( [ HE.span [ HA.class' ("flex-1 shrink-0 whitespace-nowrap font-medium " <> T.textPrimary) ] [ HE.text (Text.protectionName p.protection) ]
      , smallChip tone (Text.protectionStatusLabel status)
      ]
        <> reason
        <>
          ( if p.enabled then
              [ timeText' p.checkedAt
              , button (btnSmall <> " " <> outline) verifying (admin (Verify p.protection))
                  ((if verifying then [ spinner ] else []) <> [ HE.text Text.buttonVerify ])
              ]
            else []
          )
    )
  where
  status = { enabled: p.enabled, status: p.status }
  tone = Text.protectionStatusTone status
  verifying = elem p.protection model.verifying
  showsReason = p.enabled && (p.status == CONFIGURATION_INVALID || p.status == TEMPORARILY_UNAVAILABLE)
  reason = case Text.protectionReason p.reason of
    Just text | showsReason -> [ HE.span [ HA.class' ("text-xs " <> Text.toneClass tone) ] [ HE.text text ] ]
    _ -> []
  timeText' = maybe (HE.span [ HA.class' ("text-xs " <> T.textMuted) ] [ HE.text "—" ]) timeText

protectionKey :: RegistrationProtection -> String
protectionKey = case _ of
  EMAIL -> "email"
  BOT -> "bot"

-- ---------------------------------------------------------------------------
-- 「Webhook」タブ (ui-spec A-6。登録・編集のモーダルは保留 question-433de6d6)
-- ---------------------------------------------------------------------------

webhookPage :: Model -> Html Message
webhookPage model =
  page model AdminWebhook case model.admin.webhook of
    Loaded webhook ->
      [ HE.section [ attr "data-testid" "webhook-destinations" ]
          [ sectionHeading [ HE.text Text.webhookDestinations ]
          , destinations model.admin webhook
          ]
      ]
        <> failedSection model.admin webhook
    _ -> []

destinations :: AdminModel -> Webhook -> Html Message
destinations model webhook = case webhook.configuration of
  NOT_CONFIGURED ->
    HE.div [ HA.class' (T.surface <> " p-8 text-center") ] [ HE.span [ HA.class' ("text-sm " <> T.textMuted) ] [ HE.text Text.none ] ]
  MISCONFIGURED ->
    listSurface
      [ HE.div [ HA.class' rowClass ]
          ( [ host
            , smallChip Text.Danger Text.webhookMisconfigured
            ]
              <> maybe [] (\text -> [ HE.span [ HA.class' ("text-xs " <> T.textError) ] [ HE.text text ] ]) (webhook.issue >>= Text.webhookIssue)
          )
      ]
  CONFIGURED ->
    listSurface
      [ HE.div [ HA.class' rowClass ]
          [ host
          , if webhook.failedCount > 0 then smallChip Text.Warning Text.webhookFailing else smallChip Text.Success Text.webhookHealthy
          , button (btnSmall <> " " <> outline) model.testing (admin TestWebhook)
              ((if model.testing then [ spinner ] else []) <> [ HE.text Text.buttonTest ])
          ]
      ]
  where
  -- 宛先は host だけ (URL 全体・シークレットは BFF も扱わない)
  host = HE.span [ HA.class' ("basis-full sm:basis-auto flex-1 min-w-0 truncate font-mono font-medium " <> T.textPrimary) ] [ HE.text (fromMaybe "—" webhook.destinationHost) ]

failedSection :: AdminModel -> Webhook -> Array (Html Message)
failedSection model webhook =
  if webhook.failedCount == 0 || null webhook.deliveries then []
  else
    [ HE.section [ attr "data-testid" "webhook-failed" ]
        [ sectionHeading [ HE.text Text.webhookFailedHeading ]
        , listSurface (map row webhook.deliveries)
        ]
    ]
  where
  row :: Delivery -> Html Message
  row d =
    let
      retrying = elem d.eventId model.retrying
    in
      HE.div [ HA.class' rowClass ]
        [ timeText (fromMaybe d.createdAt d.lastAttemptAt)
        , HE.span [ HA.class' ("flex-1 min-w-0 font-medium " <> T.textPrimary) ] [ HE.text (Text.eventTitle d.eventType Nothing) ]
        , button (btnSmall <> " " <> outline) retrying (admin (RetryDelivery d.eventId))
            ((if retrying then [ spinner ] else []) <> [ HE.text Text.buttonRetry ])
        ]

-- ---------------------------------------------------------------------------
-- 強制開放中の警告帯 (ui-spec A-4)。管理画面の枠 (nav の直下) に常に出し、閉じられない
-- ---------------------------------------------------------------------------

overrideStrip :: Model -> Html Message
overrideStrip model = case model.admin.gate of
  Loaded gate | gate.overrideActive ->
    HE.div
      [ attr "role" "status"
      , attr "data-testid" "override-strip"
      , HA.class' "border-b border-error bg-[color-mix(in_srgb,var(--theme-error)_16%,var(--theme-bg-primary))]"
      ]
      [ HE.div [ HA.class' "max-w-4xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-3 text-sm" ]
          [ HE.b [ HA.class' ("flex-1 " <> T.textError) ] [ HE.text Text.overrideStrip ]
          , testButton "override-strip-revoke" (btnSmall <> " " <> dangerGhost) model.admin.pending (admin (RequestRevoke "override-strip-revoke")) [ HE.text Text.buttonStripRevoke ]
          ]
      ]
  _ -> HE.div [ HA.class' "hidden" ] []

-- ---------------------------------------------------------------------------
-- 通知ベル (ui-spec A-1)。nav の「管理」の右隣、管理者にだけ出す
-- ---------------------------------------------------------------------------

bellItem :: AdminModel -> Html Message
bellItem model =
  HE.li [ HA.class' "relative flex items-center" ]
    ( [ HE.button
          [ HA.id "notification-bell"
          , HA.type' "button"
          , HA.class' ("relative w-8 h-8 sm:w-9 sm:h-9 inline-flex items-center justify-center shrink-0 transition-colors hover:text-accent hover:bg-bg-surface " <> T.roundedTheme <> " " <> if model.bellOpen then "text-accent bg-bg-surface" else T.textSecondary)
          , attr "aria-haspopup" "dialog"
          , attr "aria-expanded" (if model.bellOpen then "true" else "false")
          , attr "aria-label" (Text.bellLabel model.unread)
          , HA.title Text.notificationsTitle
          , HA.onClick (admin ToggleBell)
          ]
          ( [ bellIcon ]
              <>
                if model.unread > 0 then
                  [ HE.span
                      [ attr "aria-hidden" "true"
                      , HA.class' "absolute top-0.5 right-0 min-w-4 h-4 px-1 rounded-full bg-error text-bg-secondary text-[10px] font-bold inline-flex items-center justify-center"
                      ]
                      [ HE.text (show model.unread) ]
                  ]
                else []
          )
      ]
        <> (if model.bellOpen then [ panel ] else [])
    )
  where
  -- 51 件目以降 (次のページがあるときだけ)
  loadMore = case model.notificationsCursor of
    Just _ ->
      [ HE.div [ HA.class' "p-2 text-center" ]
          [ testButton "notifications-more" (btnSmall <> " " <> outline) model.loadingMore (admin LoadMoreNotifications)
              ((if model.loadingMore then [ spinner ] else []) <> [ HE.text Text.buttonLoadMore ])
          ]
      ]
    Nothing -> []
  panel =
    HE.div
      [ attr "role" "dialog"
      , attr "aria-label" Text.notificationsTitle
      , attr "data-testid" "notification-panel"
      , HA.class' (T.surface <> " fixed left-2 right-2 top-[68px] max-h-[70vh] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-1 sm:w-[360px] sm:max-h-[420px] overflow-auto z-20 shadow-[0_8px_24px_rgba(0,0,0,0.45)]")
      ]
      ( [ HE.div [ HA.class' "sticky top-0 flex items-center gap-2 px-4 py-2.5 border-b border-border bg-bg-surface" ]
            [ HE.b [ HA.class' ("flex-1 text-[15px] " <> T.textHeading) ] [ HE.text Text.notificationsTitle ]
            , button (btnSmall <> " " <> outline) (model.unread == 0) (admin MarkAllRead) [ HE.text Text.buttonMarkAllRead ]
            ]
        ]
          <>
            if null model.notifications then [ HE.div [ HA.class' ("p-6 text-center text-sm " <> T.textMuted) ] [ HE.text Text.none ] ]
            else map notificationRow model.notifications <> loadMore
      )

notificationRow :: Notification -> Html Message
notificationRow n =
  HE.button
    [ HA.type' "button"
    , HA.class' "w-full text-left flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 text-sm border-b border-border last:border-b-0 hover:bg-bg-primary"
    , HA.onClick (admin (MarkRead n.id))
    ]
    [ HE.span [ HA.class' ("w-2 shrink-0 text-accent " <> if n.read then "invisible" else "") ]
        ( [ HE.span [ HA.class' "block w-2 h-2 rounded-full bg-current" ] [] ]
            <> (if n.read then [] else [ HE.span [ HA.class' "sr-only" ] [ HE.text Text.unreadMark ] ])
        )
    , HE.span [ HA.class' (Text.toneClass (Text.eventTone n.kind)), attr "aria-hidden" "true" ] [ HE.text "●" ]
    , HE.span [ HA.class' ("flex-1 min-w-0 " <> if n.read then T.textSecondary else "font-medium " <> T.textPrimary) ]
        [ HE.text (Text.eventTitle n.kind (Just { email: n.email, bot: n.bot })) ]
    , timeText n.createdAt
    ]

-- | パネルの外を押すと閉じる (nav の下の画面全体を覆う透明な層)
bellBackdrop :: AdminModel -> Html Message
bellBackdrop model =
  if model.bellOpen then HE.div [ HA.class' "fixed inset-0 z-[5]", attr "aria-hidden" "true", HA.onClick (admin CloseBell) ] []
  else HE.div [ HA.class' "hidden" ] []

bellIcon :: Html Message
bellIcon =
  HE.svg
    [ HA.viewBox "0 0 24 24"
    , HA.class' "w-5 h-5"
    , HA.fill "none"
    , HA.stroke "currentColor"
    , HA.strokeWidth "2"
    , HA.strokeLinecap "round"
    , HA.strokeLinejoin "round"
    , attr "aria-hidden" "true"
    ]
    [ HE.path [ HA.d "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" ] []
    , HE.path [ HA.d "M10.3 21a1.94 1.94 0 0 0 3.4 0" ] []
    ]
