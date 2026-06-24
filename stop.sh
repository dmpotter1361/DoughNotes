#!/usr/bin/env bash
#
# Stop DoughNotes. Your data is kept — named volumes (database, uploads, Drive
# tokens, Ollama models) are preserved; this only stops/removes the containers.
#
# Usage: ./stop.sh

set -euo pipefail
cd "$(dirname "$0")"

SUDO=""
if ! docker info >/dev/null 2>&1; then
  if sudo docker info >/dev/null 2>&1; then SUDO="sudo"; else
    echo "Cannot talk to the Docker daemon." >&2; exit 1
  fi
fi
DC="$SUDO docker compose"

echo "Stopping DoughNotes (data volumes are kept)…"
# Include every profile so caddy + ollama containers are stopped too.
$DC --profile https --profile llm down
echo "Stopped. Start again with ./start.sh"
