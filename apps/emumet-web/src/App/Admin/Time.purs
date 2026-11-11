module App.Admin.Time (formatEventTime, focusById) where

import Prelude

import Effect (Effect)
import Effect.Unsafe (unsafePerformEffect)

foreign import formatEventTimeImpl :: String -> Effect String
foreign import focusByIdImpl :: String -> Effect Unit

-- | 当日なら HH:MM、それ以外は MM/DD。管理画面のデータはクライアントで取得してから描画するので、
-- | SSR と hydration の結果は食い違わない (SSR 時点では時刻を持つデータが無い)
formatEventTime :: String -> String
formatEventTime iso = unsafePerformEffect (formatEventTimeImpl iso)

focusById :: String -> Effect Unit
focusById = focusByIdImpl
