module Client.Dialog where

import Prelude

import Effect (Effect)

-- | Turns the username `<dialog>`s into real modals (focus, Escape, restoration). Client only.
foreign import installDialogFocus :: Effect Unit
