module Test.Util where

import Prelude

import Effect (Effect)
import Effect.Class.Console (log)
import Effect.Exception (throw)

check :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
check label expected actual =
  if expected == actual then log ("ok   " <> label)
  else throw ("FAIL " <> label <> ": expected " <> show expected <> ", got " <> show actual)
