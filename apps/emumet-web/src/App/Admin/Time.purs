module App.Admin.Time (formatEventTime, focusById, trapFocus, eventKey) where

import Prelude

import Effect (Effect)
import Effect.Unsafe (unsafePerformEffect)
import Web.Event.Event (Event)

foreign import formatEventTimeImpl :: String -> Effect String
foreign import focusByIdImpl :: String -> Effect Unit
foreign import trapFocusImpl :: Event -> Effect Unit
foreign import eventKeyImpl :: Event -> String

-- | 当日なら HH:MM、それ以外は MM/DD。管理画面のデータはクライアントで取得してから描画するので、
-- | SSR と hydration の結果は食い違わない (SSR 時点では時刻を持つデータが無い)
formatEventTime :: String -> String
formatEventTime iso = unsafePerformEffect (formatEventTimeImpl iso)

focusById :: String -> Effect Unit
focusById = focusByIdImpl

trapFocus :: Event -> Effect Unit
trapFocus = trapFocusImpl

eventKey :: Event -> String
eventKey = eventKeyImpl
