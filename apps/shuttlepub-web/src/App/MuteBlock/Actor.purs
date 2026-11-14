-- | How one individual mute/block target is shown in the account list (ui-spec 1-6,
-- | d08-q18 / d08-q20): icon, name and acct, built only from what Emumet's
-- | `target_actor` says. Nothing is made up from the actor URL except as the last
-- | fallback for the name, and no state is explained: a PENDING or UNAVAILABLE target
-- | is shown like any other, with whatever it has.
module App.MuteBlock.Actor
  ( actorName
  , actorAcct
  , actorInitial
  ) where

import Prelude

import App.MuteBlock.Types (ActorPolicy)
import Data.Array (filter, last)
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String (Pattern(..), split, stripPrefix, toUpper, trim)
import Data.String.CodePoints (take) as CodePoints

-- | A field with nothing in it (empty or only blanks) is as missing as a null one.
present :: Maybe String -> Maybe String
present = case _ of
  Just text | trim text /= "" -> Just (trim text)
  _ -> Nothing

-- | `acct` as Emumet gives it: `preferred_username@host`, no leading `@`.
acctOf :: ActorPolicy -> Maybe String
acctOf policy = present policy.targetActor.acct

-- | The "@" is added for display only.
atAcct :: String -> String
atAcct acct = "@" <> acct

-- | The name of the row, and the one way the dialogs and toasts call it (d08-q20):
-- | display_name, else preferred_username, else the acct (with "@"), else the actor URL.
actorName :: ActorPolicy -> String
actorName policy = case present policy.targetActor.displayName of
  Just name -> name
  Nothing -> case present policy.targetActor.preferredUsername of
    Just name -> name
    Nothing -> case acctOf policy of
      Just acct -> atAcct acct
      Nothing -> policy.actorUrl

-- | The second line (`@acct`), unless it would only repeat the name.
actorAcct :: ActorPolicy -> Maybe String
actorAcct policy = case acctOf policy of
  Just acct | atAcct acct /= actorName policy -> Just (atAcct acct)
  _ -> Nothing

-- | The placeholder icon (the browser never loads an avatar image, d09-q06): the first
-- | character of the name. A name that is the actor URL has no character of its own, so
-- | the last path segment of the URL stands in, like before.
actorInitial :: ActorPolicy -> String
actorInitial policy = fromMaybe "?" (firstCharacter source)
  where
  source = case present policy.targetActor.displayName of
    Just name -> name
    Nothing -> case present policy.targetActor.preferredUsername of
      Just name -> name
      Nothing -> case acctOf policy of
        Just acct -> acct
        Nothing -> lastSegment policy.actorUrl

  lastSegment url = fromMaybe "" (last (filter (_ /= "") (split (Pattern "/") (withoutScheme url))))

  withoutScheme url = case stripPrefix (Pattern "https://") url of
    Just rest -> rest
    Nothing -> fromMaybe url (stripPrefix (Pattern "http://") url)

  -- A whole code point, so an emoji or a surrogate pair is never cut in half.
  firstCharacter text = case CodePoints.take 1 text of
    "" -> Nothing
    character -> Just (toUpper character)
