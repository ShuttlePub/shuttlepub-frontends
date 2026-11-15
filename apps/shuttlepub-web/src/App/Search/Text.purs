-- | Pure text helpers of the search box: splitting the input into words and `from:@acct`
-- | tokens, and the names the chip and the cards show.
module App.Search.Text
  ( Token(..)
  , Parsed
  , parse
  , keyword
  , fromAccts
  , lastFrom
  , suggestionPrefix
  , spaceConversion
  , withoutFrom
  , authorName
  , authorHandle
  , authorInitial
  , knownAuthor
  , rememberAuthor
  ) where

import Prelude

import App.Search.Types (Author)
import Data.Array (any, filter, findIndex, last, snoc, (!!))
import Data.Foldable (foldl)
import Data.Maybe (Maybe(..), isNothing)
import Data.String (Pattern(..), drop, indexOf, take, toLower, toUpper, trim)
import Data.String.CodePoints (CodePoint, codePointFromChar, fromCodePointArray, toCodePointArray)
import Data.String.CodePoints (take) as CodePoints
import Data.String.Common (joinWith)

data Token
  = Word String
  -- | `from:@acct`: the acct as typed after `from:@` (possibly empty).
  | From String

derive instance Eq Token

instance Show Token where
  show = case _ of
    Word text -> "Word " <> show text
    From acct -> "From " <> show acct

type Parsed =
  { tokens :: Array Token
  , trailingSpace :: Boolean
  }

isSpace :: CodePoint -> Boolean
isSpace point = any (_ == point) spaces
  where
  spaces = map codePointFromChar [ ' ', '\t', '\n', '\r', '\x3000', '\xA0' ]

words :: String -> Array String
words text = flush (foldl step { done: [], current: [] } (toCodePointArray text))
  where
  step acc point
    | isSpace point = acc { done = pushed acc, current = [] }
    | otherwise = acc { current = snoc acc.current point }
  pushed acc = if acc.current == [] then acc.done else snoc acc.done (fromCodePointArray acc.current)
  flush acc = pushed acc

isFromToken :: String -> Maybe String
isFromToken token
  -- `from:@` is six ASCII characters, so six code points are six code units too.
  | toLower (CodePoints.take 6 token) == "from:@" = Just (drop 6 token)
  | otherwise = Nothing

-- | The text of the box as words and `from:@` tokens. A trailing space means the last token
-- | is finished (typing a space after `from:@acct` is a conversion trigger).
parse :: String -> Parsed
parse input =
  { tokens: map token (words input)
  , trailingSpace: case last (toCodePointArray input) of
      Just point -> isSpace point
      Nothing -> false
  }
  where
  token word = case isFromToken word of
    Just acct -> From acct
    Nothing -> Word word

-- | The keyword left once every `from:@` token is taken out (words joined by one space).
keyword :: Parsed -> String
keyword parsed = joinWith " " (filterWords parsed.tokens)
  where
  filterWords tokens = tokens >>= case _ of
    Word text -> [ text ]
    From _ -> []

fromAccts :: Parsed -> Array String
fromAccts parsed = parsed.tokens >>= case _ of
  From acct -> [ acct ]
  Word _ -> []

-- | The last `from:@` token (a second `from:` replaces the first).
lastFrom :: Parsed -> Maybe String
lastFrom parsed = last (fromAccts parsed)

-- | The prefix to ask suggestions for: the token being typed is a non-empty `from:@acct`.
suggestionPrefix :: Parsed -> Maybe String
suggestionPrefix parsed
  | parsed.trailingSpace = Nothing
  | otherwise = case last parsed.tokens of
      Just (From acct) | acct /= "" -> Just acct
      _ -> Nothing

-- | A space right after `from:@acct` converts it (the last token, finished by the space).
spaceConversion :: Parsed -> Maybe String
spaceConversion parsed
  | parsed.trailingSpace = case last parsed.tokens of
      Just (From acct) -> Just acct
      _ -> Nothing
  | otherwise = Nothing

-- | The box text after its `from:@` tokens became the chip.
withoutFrom :: String -> String
withoutFrom input = keyword (parse input)

-- | The name shown for an author: the display name, else `@acct`, else the actor URL (the
-- | rule of the mute/block list; the contract has no preferred_username, and nothing is
-- | guessed from the URL).
authorName :: Author -> String
authorName author = case present author.displayName of
  Just name -> name
  Nothing | author.acct /= "" -> "@" <> author.acct
  Nothing -> author.actorUrl
  where
  present = case _ of
    Just text | trim text /= "" -> Just (trim text)
    _ -> Nothing

-- | `@user` of `user@host` for the chip; the actor URL while the acct is not known.
authorHandle :: Author -> String
authorHandle author
  | author.acct == "" = author.actorUrl
  | otherwise = "@" <> case indexOf (Pattern "@") author.acct of
      Just at -> take at author.acct
      Nothing -> author.acct

-- | The placeholder icon's letter: the first character of the name (a whole code point).
authorInitial :: Author -> String
authorInitial author
  -- Known only by the actor URL: its first letter ("h" of https) says nothing about the person.
  | author.acct == "" && isNothing author.displayName = "?"
  | otherwise =
      case CodePoints.take 1 (stripAt (authorName author)) of
        "" -> "?"
        character -> toUpper character
      where
      stripAt text = if take 1 text == "@" then drop 1 text else text

-- | The author the session knows by this actor URL, else one carrying only the URL.
knownAuthor :: Array Author -> String -> Author
knownAuthor known actorUrl = case findIndex (\author -> author.actorUrl == actorUrl) known >>= (known !! _) of
  Just author -> author
  Nothing -> { actorUrl, acct: "", displayName: Nothing }

rememberAuthor :: Author -> Array Author -> Array Author
rememberAuthor author known = snoc (filter (\other -> other.actorUrl /= author.actorUrl) known) author
