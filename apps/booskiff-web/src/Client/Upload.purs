module Client.Upload where

import Prelude

import App.Model (FileItem, UploadState)
import Data.Argonaut.Decode (decodeJson)
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either(..))
import Effect (Effect)

-- Browser File/XHR references deliberately never enter the SSR model.
foreign import initializeImpl
  :: (Array UploadState -> Effect Unit)
  -> (String -> Effect Unit)
  -> Effect Unit

foreign import configureLimit :: Number -> Effect Unit
foreign import enqueueInput :: Effect Unit
foreign import chooseFiles :: Effect Unit
foreign import retry :: String -> Effect Unit
foreign import dismiss :: String -> Effect Unit
foreign import clearFinished :: Effect Unit
foreign import reset :: Effect Unit
foreign import confirmAction :: String -> Effect Boolean
foreign import confirmLogout :: Effect Boolean

initialize :: (Array UploadState -> Effect Unit) -> (FileItem -> Effect Unit) -> Effect Unit
initialize onChange onCommit = initializeImpl onChange \body ->
  case jsonParser body of
    Left _ -> pure unit
    Right json -> case decodeJson json of
      Left _ -> pure unit
      Right file -> onCommit file
