#!/usr/bin/env bash
#
# Update DoughNotes: pull the latest code, then rebuild + restart via start.sh.
# Any flags are passed straight through to start.sh, e.g.:
#   ./update.sh --https --ai -y      # non-interactive HTTPS + AI update
#   ./update.sh                      # interactive
#
# Data is safe — DB migrations are additive and volumes are preserved.

set -euo pipefail
cd "$(dirname "$0")"

echo "Pulling latest code…"
if ! git pull --ff-only; then
  echo "git pull failed (local changes to tracked files?). Resolve them and retry." >&2
  echo "Tip: your .env is gitignored and won't be touched." >&2
  exit 1
fi

echo "Rebuilding + restarting…"
exec ./start.sh "$@"
