#!/usr/bin/env bash
# LocalWiki — quick launcher wrapper
# Usage: ./wiki generate /path/to/repo --provider gemini --lang ko

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$SCRIPT_DIR/.env"
  set +a
fi

exec python -m cli.wiki "$@"
