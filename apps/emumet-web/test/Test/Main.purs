module Test.Main where

import Prelude

import App.Username (Local(..), Reason(..), Status(..), Verdict(..), isAvailable, shouldAskServer, status, validate)
import Data.Foldable (for_)
import Data.String.CodeUnits (fromCharArray)
import Data.Array (replicate)
import Effect (Effect)
import Effect.Class.Console (log)
import Test.UpdateSpec as UpdateSpec
import Test.Util (check)

-- | Local username rules mirror Emumet (E8/P1): ^[a-z0-9][a-z0-9._-]{0,63}$ + 17 reserved
-- | words, with no implicit trimming or case folding.

main :: Effect Unit
main = do
  -- accepted
  for_ [ "alice", "a", "0", "a.b", "a_b", "a-b", "a1.b2_c3-d4", "9lives" ] \u ->
    check ("valid " <> u) LocalOk (validate u)
  check "64 chars" LocalOk (validate (fromCharArray (replicate 64 'a')))

  -- rejected by format (no trimming, no case folding)
  check "empty" Empty (validate "")
  check "65 chars" TooLong (validate (fromCharArray (replicate 65 'a')))
  for_ [ "Alice", "ALICE", "aLice", " alice", "alice ", "alice\n", "admin\n", "_a", ".a", "-a", "a b", "a@b", "a/b", "ａlice", "日本語" ] \u ->
    check ("bad format " <> show u) BadFormat (validate u)

  -- the 17 reserved words
  for_
    [ "admin", "administrator", "root", "system", "support", "security", "moderator", "api", "ap", "auth", "oauth", "oauth2", "login", "logout", "register", "settings", "well-known" ]
    \u -> check ("reserved " <> u) Reserved (validate u)
  check "reserved is exact (admin1 ok)" LocalOk (validate "admin1")
  check "reserved is case sensitive (Admin is a format error)" BadFormat (validate "Admin")

  -- status line
  check "status empty" NoStatus (status "" Unverified)
  check "status pending" Checking (status "alice" Unverified)
  check "status verified" Available (status "alice" Verified)
  check "status taken" (Unusable "利用できません") (status "alice" Taken)
  check "status unconfirmed (429 / connection trouble) is neither available nor refused" (Unconfirmed "空き状況を確認できませんでした") (status "alice" Unavailable)
  check "an unconfirmed value cannot be submitted" false (isAvailable "alice" Unavailable)
  check "status reserved (local)" (Unusable "利用できません") (status "admin" Verified)
  check "status server-rejected format" (Unusable "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます") (status "alice" (Rejected ReasonFormat))
  check "status uppercase is an error, not converted" (Unusable "先頭は a〜z か 0〜9、以降は a〜z、0〜9、. _ - が使えます") (status "Alice" Verified)

  -- the buttons
  check "available only when verified" true (isAvailable "alice" Verified)
  check "not available while unverified" false (isAvailable "alice" Unverified)
  check "verdict of another value never makes a bad value available" false (isAvailable "Alice" Verified)
  check "ask the server only for locally valid values" true (shouldAskServer "alice")
  check "do not ask for invalid values" false (shouldAskServer "Alice")
  log "all App.Username tests passed"
  UpdateSpec.run
  log "all update tests passed"
