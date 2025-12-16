#!/usr/bin/env bash
set -euo pipefail
# Close the active file tab via Advanced URI (requires Advanced URI plugin).
# Usage: VAULT_NAME="kobo-note" scripts/obs-close-active.sh [path-to-ai-context.json]
# On Linux, you may need to double-encode the entire URI before xdg-open.

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
command_enc = urllib.parse.quote("workspace:close")
# Advanced URI format
print(f"obsidian://advanced-uri?vault={vault_enc}&filepath={file_enc}&commandid={command_enc}")
PY "$CONTEXT_PATH")"

if [[ -z "$uri" ]]; then
  echo "No URI produced."
  exit 1
fi

echo "Closing via: $uri"
open "$uri"
