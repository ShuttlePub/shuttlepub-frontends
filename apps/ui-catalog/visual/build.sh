#!/usr/bin/env bash
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"
bunx spago bundle --platform browser --module Client --outfile dist/app.js
bunx spago bundle --platform node --module Server --outfile dist/server.js --bundle-type module
bun node_modules/@tailwindcss/cli/dist/index.mjs -i src/style.css -o dist/style.css
