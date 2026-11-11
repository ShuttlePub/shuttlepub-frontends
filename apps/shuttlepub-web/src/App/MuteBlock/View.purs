-- | The "ミュート・ブロック" settings page (D08 / F8). Screen structure, wording
-- | and behaviour follow the agreed UI mock v5: host
-- | intents/shuttlepub/features/personal-domain-controls-ui/ui-spec.md
-- | (1-1 … 1-6, 2-1 … 2-5) and mocks/d08-v5*.html.
-- |
-- | Deliberately absent (ui-spec "引き算"): explanations of mute vs. block, of
-- | what a block does or keeps, banners and the target Profile (1-3: the
-- | navigation's Profile switcher decides it).
module App.MuteBlock.View (view, tabPath) where

import Prelude

import App.MuteBlock.Dom (localDate)
import App.MuteBlock.Types (ActorPolicy, Dialog(..), DomainControl, Failure(..), Filter(..), Impact, InputProblem(..), Load(..), Message(..), Model, Tab(..), Toast, Undo, actorLabel, blockReady)
import Data.Array (filter, length, nub, null)
import Data.Array as Array
import Data.Maybe (Maybe(..), isJust)
import Data.String (Pattern(..), split, toUpper)
import Data.String as String
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import Generated.Schema.Gql.Enum.PolicyMode (PolicyMode(..))
import ShuttlePub.UI.Theme as T
import Web.Event.Event (Event, preventDefault)

tabPath :: Tab -> String
tabPath = case _ of
  AccountsTab -> "/settings/mute-block/accounts"
  DomainsTab -> "/settings/mute-block/domains"

view :: Tab -> Model -> Html Message
view tab model =
  HE.div [ HA.createAttribute "data-testid" "mute-block" ]
    [ HE.div
        ( [ HA.class' "grid gap-6 sm:grid-cols-[196px_minmax(0,1fr)]" ]
            <> (if isJust model.dialog then [ HA.createAttribute "inert" "", HA.createAttribute "aria-hidden" "true" ] else [])
        )
        [ subnav
        , HE.div [ HA.class' "min-w-0" ]
            [ HE.a [ HA.href "/settings", HA.class' (button "text" <> " sm:hidden -ml-2 mb-1") ]
                [ chevronLeft, HE.text "設定" ]
            , HE.h1 [ HA.id "mb-heading", HA.tabindex (-1), HA.class' ("text-xl sm:text-[22px] font-bold tracking-tight mb-1 sm:mb-2 outline-none " <> T.textHeading) ]
                [ HE.text "ミュート・ブロック" ]
            , HE.nav [ HA.class' ("flex gap-1 border-b " <> T.borderTheme), HA.createAttribute "aria-label" "対象" ]
                [ tabLink tab AccountsTab "アカウント"
                , tabLink tab DomainsTab "ドメイン"
                ]
            , case tab of
                DomainsTab -> domainPanel model
                AccountsTab -> accountPanel model
            ]
        ]
    , dialogLayer model
    , HE.div [ HA.class' "fixed inset-x-0 bottom-16 sm:bottom-6 z-40 flex justify-center px-4 pointer-events-none", HA.createAttribute "aria-live" "polite" ]
        (map toastView (Array.fromFoldable model.toast))
    ]

-- Settings side menu (desktop). Only the page that exists is listed.
subnav :: Html Message
subnav =
  HE.aside [ HA.class' "hidden sm:block text-[13px]", HA.createAttribute "aria-label" "設定メニュー" ]
    [ HE.div [ HA.class' ("text-[11px] font-bold tracking-widest mb-1.5 ml-3 " <> T.textMuted) ] [ HE.text "設定" ]
    , HE.a
        [ HA.href (tabPath DomainsTab)
        , HA.createAttribute "aria-current" "page"
        , HA.class' ("block px-3 py-[7px] font-semibold bg-accent/12 " <> T.roundedTheme <> " " <> T.textAccent)
        ]
        [ HE.text "ミュート・ブロック" ]
    ]

tabLink :: Tab -> Tab -> String -> Html Message
tabLink current tab label =
  HE.a
    ( [ HA.href (tabPath tab)
      , HA.createRawEvent "click" (navigate (Go tab))
      , HA.class'
          ( "px-3 py-2 text-sm -mb-px border-b-2 " <> focusRing <> " "
              <> if current == tab then "border-accent font-semibold " <> T.textAccent else "border-transparent " <> T.textSecondary
          )
      ] <> (if current == tab then [ HA.createAttribute "aria-current" "page" ] else [])
    )
    [ HE.text label ]

navigate :: Message -> Event -> Effect (Maybe Message)
navigate message event = preventDefault event $> Just message

-- ---------------------------------------------------------------------------
-- Lists

domainPanel :: Model -> Html Message
domainPanel model =
  HE.div [ HA.createAttribute "data-testid" "domain-panel" ]
    [ HE.div [ HA.class' "flex items-center justify-between gap-3 flex-wrap my-2 sm:mt-3 sm:mb-2 min-h-9" ]
        [ filters model.domainFilter SetDomainFilter
        , HE.button
            [ HA.id "mb-add-button"
            , HA.type' "button"
            , HA.class' ("inline-grid place-items-center w-9 h-9 border " <> T.borderTheme <> " " <> T.roundedTheme <> " " <> T.textSecondary <> " hover:text-accent " <> focusRing)
            , HA.createAttribute "aria-label" "ドメインを追加"
            , HA.onClick (OpenAdd "mb-add-button")
            ]
            [ plusIcon ]
        ]
    , listSurface model.domains model.domainFilter (\control -> control.mode) (domainRow model)
    ]

accountPanel :: Model -> Html Message
accountPanel model =
  HE.div [ HA.createAttribute "data-testid" "account-panel" ]
    [ HE.div [ HA.class' "flex items-center gap-3 flex-wrap my-2 sm:mt-3 sm:mb-2 min-h-9" ]
        [ filters model.actorFilter SetActorFilter ]
    , listSurface model.actors model.actorFilter (\policy -> policy.mode) (actorRow model)
    ]

filters :: Filter -> (Filter -> Message) -> Html Message
filters current toMessage =
  HE.div [ HA.class' "flex flex-wrap gap-1.5", HA.createAttribute "role" "group", HA.createAttribute "aria-label" "絞り込み" ]
    [ chip AllModes "すべて", chip OnlyMute "ミュート", chip OnlyBlock "ブロック" ]
  where
  chip value label =
    HE.button
      [ HA.type' "button"
      , HA.createAttribute "aria-pressed" (if current == value then "true" else "false")
      , HA.class'
          ( "px-2.5 py-1 text-xs rounded-full border " <> focusRing <> " "
              <> if current == value then "bg-accent/15 border-transparent font-semibold " <> T.textAccent else T.borderTheme <> " " <> T.textSecondary
          )
      , HA.onClick (toMessage value)
      ]
      [ HE.text label ]

listSurface :: forall a. Load (Array a) -> Filter -> (a -> PolicyMode) -> (a -> Html Message) -> Html Message
listSurface load current modeOf row =
  HE.section [ HA.class' T.surface, HA.createAttribute "data-state" (stateName load) ]
    [ case load of
        Ready items ->
          let
            shown = filter (\item -> matches current (modeOf item)) items
          in
            if null shown then empty "ありません"
            else HE.ul [ HA.class' "list-none m-0 p-0" ] (map row shown)
        Failed failure -> failureBlock failure
        _ -> empty "読み込み中…"
    ]
  where
  matches AllModes _ = true
  matches OnlyMute mode = mode == MUTE
  matches OnlyBlock mode = mode == BLOCK

stateName :: forall a. Load a -> String
stateName = case _ of
  Ready _ -> "loaded"
  Failed _ -> "error"
  _ -> "loading"

empty :: String -> Html Message
empty text = HE.div [ HA.class' ("px-4 py-6 text-center text-[13px] " <> T.textMuted) ] [ HE.text text ]

failureBlock :: Failure -> Html Message
failureBlock failure =
  HE.div [ HA.class' "px-4 py-6 text-center text-[13px] flex flex-col items-center gap-2", HA.createAttribute "role" "alert", HA.createAttribute "data-error" (code failure) ]
    ([ HE.span [ HA.class' T.textError ] [ HE.text (describe failure) ] ] <> map recoveryButton (recovery failure))

entryClass :: String
entryClass = "flex items-center gap-2.5 px-3 sm:px-4 py-2.5 border-t first:border-t-0 " <> T.borderTheme

domainRow :: Model -> DomainControl -> Html Message
domainRow model control =
  HE.li [ HA.class' entryClass, HA.createAttribute "data-domain" control.domain ]
    [ HE.div [ HA.class' "flex-1 min-w-0" ]
        [ HE.div [ HA.class' ("font-mono font-semibold break-all " <> T.textHeading) ] [ HE.text control.domain ]
        , HE.div [ HA.class' ("text-xs " <> T.textMuted) ] [ HE.text (localDate control.createdAt) ]
        ]
    , rowButton model ("mb-domain-" <> control.domain) control.mode control.domain
        ( case control.mode of
            MUTE -> UnmuteDomain control
            BLOCK -> OpenDomainUnblock ("mb-domain-" <> control.domain) control
        )
    ]

actorRow :: Model -> ActorPolicy -> Html Message
actorRow model policy =
  HE.li [ HA.class' entryClass, HA.createAttribute "data-actor" policy.actorUrl ]
    [ HE.span [ HA.class' ("flex-none inline-grid place-items-center w-7 h-7 text-xs font-bold bg-accent " <> T.roundedTheme <> " text-bg-primary"), HA.createAttribute "aria-hidden" "true" ]
        [ HE.text (initial policy.actorUrl) ]
    , HE.div [ HA.class' "flex-1 min-w-0" ]
        [ HE.div [ HA.class' ("font-mono font-semibold break-all " <> T.textHeading) ] [ HE.text label ]
        , HE.div [ HA.class' ("text-xs " <> T.textMuted) ] [ HE.text (localDate policy.createdAt) ]
        ]
    , rowButton model ("mb-actor-" <> policy.id) policy.mode label
        ( case policy.mode of
            MUTE -> UnmuteActor policy
            BLOCK -> OpenActorUnblock ("mb-actor-" <> policy.id) policy
        )
    ]
  where
  label = actorLabel policy.actorUrl

-- | ui-spec 1-6: no badge; the button's wording and text colour carry the kind.
rowButton :: Model -> String -> PolicyMode -> String -> Message -> Html Message
rowButton model id mode target message =
  HE.button
    [ HA.id id
    , HA.type' "button"
    , HA.disabled model.writing
    , HA.class' (button "" <> " min-w-24 flex-none " <> if mode == BLOCK then T.textError else T.textTempLow)
    , HA.createAttribute "aria-label" (label <> "（" <> target <> "）")
    , HA.onClick message
    ]
    [ HE.text label ]
  where
  label = modeLabel mode <> "解除"

modeLabel :: PolicyMode -> String
modeLabel = case _ of
  MUTE -> "ミュート"
  BLOCK -> "ブロック"

initial :: String -> String
initial url = case Array.last (filter (_ /= "") (split (Pattern "/") (actorLabel url))) of
  Just segment -> toUpper (String.take 1 segment)
  Nothing -> "?"

-- ---------------------------------------------------------------------------
-- Dialogs (ui-spec 1-5, 2-1 … 2-5). Mobile: bottom sheet.

dialogLayer :: Model -> Html Message
dialogLayer model = case model.dialog of
  Nothing -> HE.div [ HA.class' "hidden" ] []
  Just dialog ->
    HE.div
      [ HA.class' "fixed inset-0 z-30 flex items-end sm:items-center justify-center sm:p-6"
      , HA.onKeydown (\(Tuple key _) -> if key == "Escape" then CloseDialog else NoOp)
      ]
      [ HE.div [ HA.class' "absolute inset-0 bg-black/55", HA.onClick CloseDialog, HA.createAttribute "data-testid" "dialog-backdrop" ] []
      , dialogView dialog
      ]

dialogBox :: String -> Array (Html Message) -> Html Message
dialogBox testId children =
  HE.div
    [ HA.class' ("relative w-full sm:max-w-[440px] max-h-[92%] sm:max-h-[calc(100%-24px)] overflow-auto bg-bg-primary border border-b-0 sm:border-b " <> T.borderTheme <> " rounded-t-theme-lg sm:rounded-theme-lg shadow-[0_16px_56px_rgba(0,0,0,.45)]")
    , HA.createAttribute "role" "dialog"
    , HA.createAttribute "aria-modal" "true"
    , HA.createAttribute "aria-labelledby" "mb-dialog-title"
    , HA.createAttribute "data-testid" testId
    ]
    children

dialogHead :: Array (Html Message) -> Boolean -> Maybe Message -> Html Message
dialogHead title scoped close =
  HE.div [ HA.class' "flex items-start gap-2 px-4 sm:px-5 pt-4" ]
    ( [ HE.div [ HA.class' "flex-1 min-w-0" ]
          ( [ HE.h2 [ HA.id "mb-dialog-title", HA.class' ("text-[17px] font-semibold break-words " <> T.textHeading) ] title ]
              <> (if scoped then [ HE.div [ HA.class' ("text-xs mt-1 " <> T.textMuted) ] [ HE.text "このドメインのみが対象です" ] ] else [])
          )
      ]
        <> case close of
          Just message ->
            [ HE.button
                [ HA.type' "button"
                , HA.class' ("inline-grid place-items-center w-8 h-8 " <> T.roundedTheme <> " " <> T.textSecondary <> " hover:text-accent " <> focusRing)
                , HA.createAttribute "aria-label" "閉じる"
                , HA.onClick message
                ]
                [ xIcon ]
            ]
          Nothing -> []
    )

dialogBody :: Array (Html Message) -> Html Message
dialogBody = HE.div [ HA.class' ("px-4 sm:px-5 pt-2 text-sm " <> T.textSecondary) ]

dialogFoot :: Array (Html Message) -> Html Message
dialogFoot = HE.div [ HA.class' "sticky bottom-0 flex flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end gap-2 px-4 sm:px-5 pt-3 sm:pt-4 pb-4 bg-bg-primary" ]

footButton :: String -> Boolean -> Message -> String -> Html Message
footButton kind disabled message label =
  HE.button
    [ HA.type' "button", HA.disabled disabled, HA.class' (button kind <> " w-full sm:w-auto min-h-10 sm:min-h-9 px-3.5 py-1.5 text-sm"), HA.onClick message ]
    [ HE.text label ]

-- | The first footer button gets the initial focus (mb-dialog-first).
firstButton :: String -> Boolean -> Message -> String -> Html Message
firstButton kind disabled message label =
  HE.button
    [ HA.id "mb-dialog-first", HA.type' "button", HA.disabled disabled, HA.class' (button kind <> " w-full sm:w-auto min-h-10 sm:min-h-9 px-3.5 py-1.5 text-sm"), HA.onClick message ]
    [ HE.text label ]

mono :: String -> Html Message
mono text = HE.span [ HA.class' "font-mono" ] [ HE.text text ]

failureLine :: Maybe Failure -> Array (Html Message)
failureLine = case _ of
  Nothing -> []
  Just failure ->
    [ HE.div [ HA.class' "flex flex-wrap items-center gap-2 mt-2 text-xs", HA.createAttribute "role" "alert", HA.createAttribute "data-error" (code failure) ]
        ([ HE.span [ HA.class' T.textError ] [ HE.text (describe failure) ] ] <> map recoveryButton (recovery failure))
    ]

dialogView :: Dialog -> Html Message
dialogView = case _ of
  AddDomain state ->
    dialogBox "add-dialog"
      [ dialogHead [ HE.text "ドメインを追加" ] false (Just CloseDialog)
      , dialogBody
          ( [ HE.input
                ( [ HA.id "mb-add-input"
                  , HA.type' "text"
                  , HA.value state.input
                  , HA.placeholder "example.social"
                  , HA.createAttribute "inputmode" "url"
                  , HA.createAttribute "autocomplete" "off"
                  , HA.createAttribute "spellcheck" "false"
                  , HA.createAttribute "aria-label" "ドメイン"
                  , HA.class' ("w-full font-mono px-3 py-1.5 min-h-9 text-sm border bg-bg-surface " <> T.textPrimary <> " " <> T.roundedTheme <> " focus:outline-none focus:ring-2 focus:ring-accent/50 " <> if isJust state.problem then "border-error" else T.borderTheme)
                  , HA.onInput AddInput
                  ] <> case state.problem of
                    Just _ -> [ HA.createAttribute "aria-invalid" "true", HA.createAttribute "aria-describedby" "mb-add-error" ]
                    Nothing -> []
                )
            ] <> case state.problem of
              Just problem -> [ HE.div [ HA.id "mb-add-error", HA.class' "mt-1.5 text-xs text-error", HA.createAttribute "role" "alert" ] [ HE.text (problemText problem) ] ]
              Nothing -> []
          )
      , dialogFoot
          [ footButton "" state.pending (SubmitAdd MUTE) "ミュート"
          , footButton "danger" state.pending (SubmitAdd BLOCK) "ブロック"
          ]
      ]
  ConfirmMute state ->
    let
      change = map _.mode state.current == Just BLOCK
      verb = if change then "ミュートに変更" else "ミュート"
    in
      dialogBox "mute-dialog"
        [ dialogHead [ mono state.domain, HE.text (" を" <> verb <> "しますか？") ] state.fromInput Nothing
        , dialogBody (failureLine state.failure)
        , dialogFoot
            [ firstButton "muted" state.pending CloseDialog "キャンセル"
            , footButton "primary" state.pending ConfirmMuteDomain verb
            ]
        ]
  ConfirmBlock state ->
    let
      ready = blockReady state
      fromMute = map _.mode state.current == Just MUTE
    in
      dialogBox "block-dialog"
        [ dialogHead [ mono state.domain, HE.text " をブロックしますか？" ] state.fromInput Nothing
        , dialogBody (impactView state.impact state.acknowledged state.pending <> failureLine state.failure)
        , dialogFoot
            ( [ firstButton "muted" state.pending CloseDialog "キャンセル" ]
                <> (if fromMute then [] else [ footButton "" state.pending MuteInstead "代わりにミュート" ])
                <> [ footButton "danger" (state.pending || not ready) ConfirmBlockDomain "ブロック" ]
            )
        ]
  ConfirmDomainUnblock state ->
    dialogBox "unblock-dialog"
      [ dialogHead [ mono state.control.domain, HE.text " のブロックを解除しますか？" ] false Nothing
      , dialogBody
          ( [ HE.p [ HA.class' "m-0" ] [ mono state.control.domain, HE.text " の人とフォローやリアクションなどができるようになります。" ] ]
              <> failureLine state.failure
          )
      , dialogFoot
          [ firstButton "muted" state.pending CloseDialog "キャンセル"
          , footButton "" state.pending DomainUnblockToMute "ミュートに変更"
          , footButton "primary" state.pending ConfirmDomainUnblockNow "ブロック解除"
          ]
      ]
  ConfirmActorUnblock state ->
    let
      label = actorLabel state.policy.actorUrl
    in
      dialogBox "unblock-dialog"
        [ dialogHead [ mono label, HE.text " のブロックを解除しますか？" ] false Nothing
        , dialogBody
            ( [ HE.p [ HA.class' "m-0" ] [ mono label, HE.text " とフォローやリアクションなどができるようになります。" ] ]
                <> failureLine state.failure
            )
        , dialogFoot
            [ firstButton "muted" state.pending CloseDialog "キャンセル"
            , footButton "" state.pending ActorUnblockToMute "ミュートに変更"
            , footButton "primary" state.pending ConfirmActorUnblockNow "ブロック解除"
            ]
        ]

-- | ui-spec 2-1 / 2-2: the number of follows a block detaches, the accounts
-- | behind a disclosure, and the "does not come back" acknowledgement only when
-- | something is detached. Nothing at all when nothing is.
impactView :: Load Impact -> Boolean -> Boolean -> Array (Html Message)
impactView load acknowledged pending = case load of
  Ready impact
    | null impact.following && null impact.followers -> []
    | otherwise ->
        [ HE.div [ HA.class' ("px-3 py-2.5 text-[13px] " <> T.roundedTheme <> " " <> T.textPrimary <> " bg-error/8 border border-error/30"), HA.createAttribute "data-testid" "block-impact" ]
            [ HE.div_
                [ HE.text "フォロー中 "
                , HE.b_ [ HE.text (show (length impact.following)) ]
                , HE.text " 人・フォロワー "
                , HE.b_ [ HE.text (show (length impact.followers)) ]
                , HE.text " 人の関係が解除されます"
                ]
            , HE.details [ HA.class' "mt-1" ]
                [ HE.summary [ HA.class' ("cursor-pointer text-xs " <> T.textAccent <> " " <> focusRing) ]
                    [ HE.text ("対象を表示（" <> show (length people) <> " 人）") ]
                , HE.ul [ HA.class' "list-none mt-2 p-0 grid gap-1.5" ] (map person people)
                ]
            ]
        , acknowledgement
        ]
        where
        people = nub (impact.following <> impact.followers)
        person url =
          HE.li [ HA.class' "flex items-center gap-2 text-xs" ]
            [ HE.span [ HA.class' "flex-1 min-w-0 font-mono break-all" ] [ HE.text (actorLabel url) ]
            , HE.span [ HA.class' ("text-[11px] font-semibold px-2 py-0.5 bg-text-muted/20 " <> T.roundedTheme <> " " <> T.textSecondary) ]
                [ HE.text (relationLabel url) ]
            ]
        relationLabel url = case Tuple (Array.elem url impact.following) (Array.elem url impact.followers) of
          Tuple true true -> "相互"
          Tuple true false -> "フォロー中"
          _ -> "フォロワー"
  Failed failure ->
    [ HE.div [ HA.class' "text-xs text-error", HA.createAttribute "role" "alert", HA.createAttribute "data-error" (code failure) ]
        [ HE.text "解除される関係を確認できませんでした" ]
    , acknowledgement
    ]
  _ -> []
  where
  acknowledgement =
    HE.label [ HA.class' ("flex items-start gap-2 mt-3 text-[13px] cursor-pointer " <> T.textPrimary) ]
      [ HE.input
          [ HA.type' "checkbox"
          , HA.id "mb-acknowledge"
          , HA.checked acknowledged
          , HA.disabled pending
          , HA.class' "mt-[3px] w-4 h-4 flex-none accent-error"
          , HA.onCheck ToggleAcknowledged
          ]
      , HE.span_ [ HE.text "解除した関係は元に戻らないことを確認しました" ]
      ]

problemText :: InputProblem -> String
problemText = case _ of
  InputRefused "EMPTY" -> "ドメインを入力してください"
  InputRefused "WILDCARD" -> "ワイルドカードは使えません"
  InputRefused "IP_ADDRESS" -> "IP アドレスは指定できません"
  InputRefused "OWN_SERVER" -> "自分のサーバーは指定できません"
  InputRefused _ -> "ドメインの形式が正しくありません"
  AlreadySet mode -> "すでに" <> modeLabel mode <> "しています"
  InputFailed failure -> describe failure

-- ---------------------------------------------------------------------------
-- Toast

toastView :: Toast -> Html Message
toastView toast =
  HE.div
    [ HA.class' ("pointer-events-auto flex items-center gap-3 max-w-full px-3.5 py-2.5 text-[13px] bg-bg-surface border " <> T.borderTheme <> " " <> T.roundedTheme <> " shadow-[0_8px_28px_rgba(0,0,0,.4)]")
    , HA.createAttribute "role" "status"
    , HA.createAttribute "data-testid" "toast"
    , HA.onMouseenter (ToastHold true)
    , HA.onMouseleave (ToastHold false)
    , HA.onFocusin (ToastHold true)
    , HA.onFocusout (ToastHold false)
    ]
    ( case toast.failure of
        Just failure ->
          [ HE.span [ HA.class' T.textError, HA.createAttribute "data-error" (code failure) ] [ HE.text (describe failure) ] ]
            <> map recoveryButton (recovery failure)
        Nothing ->
          [ HE.span_ [ mono toast.subject, HE.text toast.rest ] ]
            <> map undoButton (Array.fromFoldable toast.undo)
    )
  where
  undoButton :: Undo -> Html Message
  undoButton _ = HE.button [ HA.type' "button", HA.class' (button "text"), HA.onClick RunUndo ] [ HE.text "元に戻す" ]

-- ---------------------------------------------------------------------------
-- Failures: short, and with the way back when the shown state may be stale.

code :: Failure -> String
code (Failure value) = value

describe :: Failure -> String
describe (Failure value) = case value of
  "UNAUTHENTICATED" -> "ログインが必要です"
  "FORBIDDEN" -> "この Profile では操作できません"
  "PROFILE_REQUIRED" -> "Profile を選択してください"
  "PROFILE_CHANGED" -> "Profile が切り替わりました"
  "PROFILE_UNAVAILABLE" -> "Profile が切り替わりました"
  "REVISION_CONFLICT" -> "ほかの操作で変更されています"
  "NOT_FOUND" -> "見つかりません"
  "ALREADY_EXISTS" -> "すでに設定されています"
  "INVALID_DOMAIN" -> "ドメインの形式が正しくありません"
  "NOT_IMPLEMENTED" -> "サーバーが未対応です"
  "UPSTREAM_UNAVAILABLE" -> "サーバーに接続できません"
  "NETWORK" -> "サーバーに接続できません"
  _ -> "エラーが発生しました"

data Recovery = ReloadLists | ReloadWholePage | LogIn

recovery :: Failure -> Array Recovery
recovery (Failure value) = case value of
  "UNAUTHENTICATED" -> [ LogIn ]
  "PROFILE_CHANGED" -> [ ReloadWholePage ]
  "PROFILE_UNAVAILABLE" -> [ ReloadWholePage ]
  "PROFILE_REQUIRED" -> []
  "INVALID_DOMAIN" -> []
  _ -> [ ReloadLists ]

recoveryButton :: Recovery -> Html Message
recoveryButton = case _ of
  ReloadLists -> HE.button [ HA.type' "button", HA.class' (button "text"), HA.onClick Reload ] [ HE.text "再読み込み" ]
  ReloadWholePage -> HE.button [ HA.type' "button", HA.class' (button "text"), HA.onClick ReloadPage ] [ HE.text "再読み込み" ]
  LogIn -> HE.a [ HA.href ("/auth/login?return_to=" <> tabPath DomainsTab), HA.class' (button "text") ] [ HE.text "ログイン" ]

-- ---------------------------------------------------------------------------
-- Shared bits

focusRing :: String
focusRing = "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"

-- | Button styles of the mock (.btn, .btn.muted / .primary / .danger / .text).
button :: String -> String
button kind =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1 text-xs font-medium min-h-[30px] border whitespace-nowrap no-underline hover:opacity-85 disabled:opacity-45 disabled:cursor-not-allowed "
    <> T.roundedTheme
    <> " "
    <> focusRing
    <> " "
    <> case kind of
      "muted" -> T.borderTheme <> " " <> T.textSecondary
      "primary" -> "bg-accent text-bg-primary border-transparent font-semibold"
      "danger" -> "bg-error text-bg-primary border-transparent font-semibold"
      "text" -> "border-transparent " <> T.textAccent
      _ -> T.borderTheme <> " " <> T.textAccent

icon :: String -> Html Message
icon d =
  HE.svg
    [ HA.class' "w-[18px] h-[18px] flex-none"
    , HA.createAttribute "viewBox" "0 0 24 24"
    , HA.createAttribute "fill" "none"
    , HA.createAttribute "stroke" "currentColor"
    , HA.createAttribute "stroke-width" "2.2"
    , HA.createAttribute "stroke-linecap" "round"
    , HA.createAttribute "stroke-linejoin" "round"
    , HA.createAttribute "aria-hidden" "true"
    ]
    [ HE.path' [ HA.createAttribute "d" d ] ]

plusIcon :: Html Message
plusIcon = icon "M12 5v14M5 12h14"

xIcon :: Html Message
xIcon = icon "M6 6l12 12M18 6L6 18"

chevronLeft :: Html Message
chevronLeft = icon "M15 18l-6-6 6-6"
