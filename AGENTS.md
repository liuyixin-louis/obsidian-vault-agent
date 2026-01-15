# Codex Agent Instructions — Obsidian Vault

You are working inside an Obsidian vault on macOS. This vault provides live context in `.obsidian/ai-context.json` describing the active note, folder, and cursor/selection so you can target the correct section and insertion point.

## Mandatory: read context first
Before any file edits, searches, or commands:

1) Read `.obsidian/ai-context.json`.
2) Extract:
   - `activeFileSystemPath`, `activeFileVaultPath`
   - `activeFolderSystemPath`, `activeFolderVaultPath`
   - `activeHeadingPath`, `cursorLine`, `cursorCh`, optional `selectionText`

If `activeFileSystemPath` exists, treat it as the default file unless the user specifies another file.

## Section targeting priority
When the user request can be localized:

1) If `selectionText` exists: operate on the selection.
2) Else if `activeHeadingPath` exists: operate on the section under that heading.
3) Else: operate on the whole active note.

Prefer minimal changes and small diffs.

## Working directory
When running commands, prefer:
- `activeFolderSystemPath` if present,
- otherwise the vault root (current project root).

## Output convention (recommended)
If you create an "output note" (summary, extraction, rewritten draft, report), use:

- Directory: `<activeFolderVaultPath>/_generated/`
- Filename: `YYYYMMDD-HHMM__<slug>.md`
- After creating it, update the active note by appending/updating:

```md
## AI Outputs
- [[<vault-relative-path-to-output>]]
```

Do not delete or overwrite existing outputs unless the user explicitly asks.

## Placement tasks (content not based on the active note)

If the user provides content and asks you to find an appropriate place in the vault (without specifying a target note/folder):

### Procedure (tree → bounded DFS → ask)

1. **Quick tree scan**
   - Inspect top-level folders first.
   - Then inspect 1–2 likely candidate branches at shallow depth (1–2).

2. **Bounded DFS if needed**
   - Only traverse limited depth and number of entries.
   - Prefer filename/title matching before content searches.
   - Search inside file contents only after narrowing to a small candidate set.

3. **If still unclear**
   - Propose 2–3 destination options with reasoning and ask the user to pick.
   - If none fit, ask whether the user wants to reorganize or create a new folder; propose a sensible folder name.

### Suggested command patterns

**Structure:**
- `ls`
- `find . -maxdepth 2 -type d`

**Narrow search:**
- `find . -maxdepth 4 -iname "*keyword*"`
- `rg -n "keyword" --glob "*.md" <candidate-folder>`

## Opening notes in Obsidian (ONLY when the user asks)

Do NOT auto-open notes. Only open/show in Obsidian if the user explicitly asks.

To open a note by vault-relative path (macOS):

```bash
open "obsidian://open?vault=YOUR_VAULT_NAME&file=<URL_ENCODED_VAULT_PATH>"
```

To open the current active note (uses `activeFileVaultPath`):

```bash
python3 - <<'PY'
import json, pathlib, urllib.parse, subprocess
vault="YOUR_VAULT_NAME"  # Replace with your vault name
ctx=json.loads(pathlib.Path(".obsidian/ai-context.json").read_text(encoding="utf-8"))
p=ctx.get("activeFileVaultPath")
if not p:
    raise SystemExit("No activeFileVaultPath")
uri=f"obsidian://open?vault={urllib.parse.quote(vault)}&file={urllib.parse.quote(p)}"
subprocess.run(["open", uri], check=False)
print(uri)
PY
```

## Writing notes (Obsidian hygiene)

- Preserve Obsidian markdown: `[[wikilinks]]`, `![[embeds]]`, YAML frontmatter, tags, and callouts.
- Avoid destructive actions. Never delete/move files unless explicitly asked.

## Communication

- If uncertain about target file/section, re-read `.obsidian/ai-context.json` and proceed with the priority: selection → current heading → whole note.
- If `.obsidian/ai-context.json` is missing, use a short message (e.g., "No ai-context.json found; please open Obsidian or specify a target file.") and avoid repeating the full error sentence.
- Prefer small, reviewable diffs.
- For placement tasks: prefer proposing options and asking the user rather than scanning the entire vault.
