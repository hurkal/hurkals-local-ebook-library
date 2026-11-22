#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info.major >= 3 else 1)' >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Error: Python 3 is required to run the indexer on Linux/macOS." >&2
  echo "Install Python 3 via your package manager (e.g., 'sudo apt install python3' or 'brew install python3')." >&2
  exit 1
fi

echo "Updating E-Book Library database..."
"$PYTHON_BIN" "$SCRIPT_DIR/app/scripts/index-ebooks.py" "$@"
