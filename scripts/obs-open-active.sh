#!/usr/bin/env bash
set -euo pipefail
# Open the active file from .obsidian/ai-context.json in Obsidian via obsidian://open
# Usage: VAULT_NAME="kobo-note" scripts/obs-open-active.sh [path-to-ai-context.json]

VAULT_NAME="${VAULT_NAME:-kobo-note}"
CONTEXT_PATH="${1:-.obsidian/ai-context.json}"

uri="$(python3 - <<'PY'
import json, urllib.parse, pathlib, os, sys

vault = os.environ.get("VAULT_NAME", "kobo-note")
ctx_path = pathlib.Path(sys.argv[1])
data = json.loads(ctx_path.read_text())
path = data.get("activeFileVaultPath")
if not path:
    sys.exit("No activeFileVaultPath in context.")

vault_enc = urllib.parse.quote(vault)
file_enc = urllib.parse.quote(path)
print(f"obsidian://open?vault={vault_enc}&file={file_enc}")
PY "$CONTEXT_PATH")"

if [[ -z "$uri" ]]; then
  echo "No URI produced."
  exit 1
fi

echo "Opening: $uri"
open "$uri"
