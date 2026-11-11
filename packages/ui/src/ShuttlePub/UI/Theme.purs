module ShuttlePub.UI.Theme where

import Prelude

-- Background
bgPrimary :: String
bgPrimary = "bg-bg-primary"

bgSecondary :: String
bgSecondary = "bg-bg-secondary"

bgSurface :: String
bgSurface = "bg-bg-surface"

bgNav :: String
bgNav = "bg-bg-nav"

-- Text
textPrimary :: String
textPrimary = "text-text-primary"

textSecondary :: String
textSecondary = "text-text-secondary"

textMuted :: String
textMuted = "text-text-muted"

textHeading :: String
textHeading = "text-text-heading"

textAccent :: String
textAccent = "text-accent"

-- Semantic
textError :: String
textError = "text-error"

textSuccess :: String
textSuccess = "text-success"

textWarning :: String
textWarning = "text-warning"

textTempHigh :: String
textTempHigh = "text-temp-high"

textTempLow :: String
textTempLow = "text-temp-low"

-- Border
borderTheme :: String
borderTheme = "border-border"

-- Accent
bgAccent :: String
bgAccent = "bg-accent"

hoverBgAccent :: String
hoverBgAccent = "hover:bg-accent-hover"

hoverTextAccent :: String
hoverTextAccent = "hover:text-accent"

-- Shape
roundedTheme :: String
roundedTheme = "rounded-theme"

roundedThemeLg :: String
roundedThemeLg = "rounded-theme-lg"

shadowTheme :: String
shadowTheme = "shadow-theme"

-- Composites
surface :: String
surface = roundedThemeLg <> " border " <> borderTheme <> " " <> bgSurface <> " " <> shadowTheme

navLink :: String
navLink = "px-3 py-2 text-sm font-medium " <> textSecondary <> " " <> roundedTheme <> " transition-colors " <> hoverTextAccent <> " hover:bg-bg-surface"
