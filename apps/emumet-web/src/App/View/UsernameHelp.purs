module App.View.UsernameHelp where

import Prelude

import App.Message (Message)
import Flame (Html)
import Flame.Html.Attribute as HA
import Flame.Html.Element as HE
import ShuttlePub.UI.Theme as T

-- | Minimal help for the username input (spec: the "(?)" next to the label leads here).
-- | The wording follows ui-username-spec.md; it adds no new rule.
view :: Html Message
view =
  HE.div [ HA.class' "space-y-2.5 sm:space-y-4" ]
    [ HE.h1 [ HA.class' ("text-xl sm:text-2xl font-bold tracking-tight " <> T.textHeading), HA.id "username-help-title" ]
        [ HE.text "ユーザー名について" ]
    , HE.div [ HA.class' (T.surface <> " p-3 sm:p-4") ]
        [ HE.ul [ HA.class' ("list-disc space-y-1.5 pl-5 text-sm " <> T.textPrimary) ]
            [ HE.li_ [ HE.text "使える文字は a〜z・0〜9・. _ - で、1〜64 文字です。" ]
            , HE.li_ [ HE.text "先頭は a〜z か 0〜9 にしてください。" ]
            , HE.li_ [ HE.text "大文字は使えません (自動では小文字になりません)。" ]
            , HE.li_ [ HE.text "予約語・すでに使われている名前は「利用できません」と表示されます。" ]
            , HE.li_ [ HE.text "ユーザー名は後から変更できません。" ]
            ]
        ]
    ]
