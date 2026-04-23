#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT_DIR"

PUBLIC_RUNTIME_MODE=pages-static npm run build
npx wrangler deploy --config "$ROOT_DIR/dist/server/wrangler.json"
