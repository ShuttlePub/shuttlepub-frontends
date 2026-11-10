module App.Profile where

import Data.Maybe (Maybe)

-- | Profile context: the Profile the viewer is currently acting as. Mirrors the
-- | app-owned GraphQL types Profile / ProfileContext (bff/schema.graphql).
type Profile =
  { id :: String
  , handle :: String
  , displayName :: String
  }

type ProfileContext =
  { activeProfile :: Maybe Profile
  }
