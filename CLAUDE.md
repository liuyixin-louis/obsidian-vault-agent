# Claude Code — Obsidian Vault Assistant

You are operating inside an Obsidian vault. This vault provides a live context file that describes what the user is currently viewing (file, folder, cursor/heading, optional selection).

## Always read Obsidian context first
At the start of **every session** (and before taking any action that reads/writes files), do the following:

1) Read:
- `.obsidian/ai-context.json`

Then follow the rules below.

## Active context rules
From `.obsidian/ai-context.json`, use these fields:

- `activeFileSystemPath` (absolute path to the current note)
- `activeFileVaultPath` (vault-relative path to the current note)
- `activeFolderSystemPath` (absolute path to the folder containing the current note)
- `activeFolderVaultPath` (vault-relative path to the folder containing the current note)

Cursor/section targeting:
- `activeHeadingPath` (heading path for the cursor position, if available)
- `cursorLine`, `cursorCh` (cursor position)
- `selectionText` (optional; only present if the user selected text; trimmed)

### Default target = active file (for edits), no auto-open
If `activeFileSystemPath` is present and the file exists:
- Use it as the default target when the user asks to edit/update/summarize without specifying a file path.
- Do **not** automatically open notes in Obsidian.

### Prefer operating on the current section
When the user asks for help that could apply to a section (rewrite/summarize/extract tasks/translate/outline), prefer this priority:

1) If `selectionText` exists: operate on the selection.
2) Else if `activeHeadingPath` exists: operate on the section under that heading.
3) Else: operate on the whole active note.

If you cannot reliably identify the section boundaries, use the selection if present; otherwise operate on the whole note.

### Working directory + output convention
Prefer operating within `activeFolderSystemPath` when creating related files.

If you create a new "output note" (summary, extracted tasks, report, rewritten draft), use this convention unless the user requests otherwise:

- Create: `<activeFolderVaultPath>/_generated/`
- Filename: `YYYYMMDD-HHMM__<slug>.md`
- At the end of the active note, append/update an index block:

```md
## AI Outputs
- [[<vault-relative-path-to-output>]]
```

Do not delete or overwrite existing outputs unless requested.

## Placement tasks (content not based on the active note)

Sometimes the user provides content and asks "where should I put this in my vault?" without referencing the active note. In this case:

### Goal

Find the most appropriate folder/note location with minimal scanning. If uncertain, propose options and ask the user.

### Procedure (tree → bounded DFS → ask)

1. **Quick tree scan (structure only)**
   - Start from vault root and inspect the top-level structure first (e.g., list top-level folders).
   - Then inspect 1–2 likely top-level candidates with a shallow tree (depth 1–2).

2. **If still ambiguous, do bounded DFS**
   - Only traverse a limited depth and limited number of entries.
   - Prefer folder names + note titles to infer semantics.
   - Use keyword search on filenames first; only search inside file contents if needed.

3. **If you still can't decide**
   - Propose 2–3 candidate destinations (with reasoning).
   - Ask the user to choose.
   - If none fit, ask whether they want to reorganize or create a new folder, and propose a sensible new folder name.

### Heuristics

- Prefer existing taxonomy over creating new folders.
- If content is "inbox-like" (quick dump, unclassified), suggest a neutral landing area (e.g., `Inbox/Unsorted`) if it exists; otherwise propose creating one.
- For research/career/coding/life/journal knowledge, bias toward matching existing top-level categories.

### Commands you may use (examples)

**Structure:**
- `ls` (top-level)
- `find . -maxdepth 2 -type d` (shallow folders)

**Candidate search:**
- `find . -maxdepth 4 -iname "*keyword*"`
- `rg -n "keyword" --glob "*.md" <candidate-folder>` (only in narrowed folders)

## How to open/show a note in Obsidian (ONLY when the user asks)

Only do this if the user explicitly asks things like:
- "open this note in Obsidian"
- "show the output note"
- "jump to the generated note"

### macOS: open a vault-relative path in Obsidian

Obsidian supports `obsidian://open` URIs.

To open a note by vault-relative path:

```bash
open "obsidian://open?vault=YOUR_VAULT_NAME&file=<URL_ENCODED_VAULT_PATH>"
```

To URL-encode a vault path:

```bash
python3 - <<'PY'
import urllib.parse
p = "Career/Applications/Applications.md"
print(urllib.parse.quote(p))
PY
```

### Open the current active note (when asked)

If the user asks to open the currently active note, read `activeFileVaultPath` and open it:

```bash
python3 - <<'PY'
import json, pathlib, urllib.parse, subprocess
vault = "YOUR_VAULT_NAME"  # Replace with your vault name
ctx = json.loads(pathlib.Path(".obsidian/ai-context.json").read_text(encoding="utf-8"))
p = ctx.get("activeFileVaultPath")
if not p:
    raise SystemExit("No activeFileVaultPath in .obsidian/ai-context.json")
uri = f"obsidian://open?vault={urllib.parse.quote(vault)}&file={urllib.parse.quote(p)}"
subprocess.run(["open", uri], check=False)
print(uri)
PY
```

### Open the output note you just generated (when asked)

If you created/modified a note as output, you should know its vault-relative path. When the user asks to "show/open it", open it using the same `open "obsidian://open?...` method above.

## Safety & hygiene

- Do not delete files unless the user explicitly asks.
- Prefer minimal, reversible edits (small diffs, focused sections).
- Preserve Obsidian markdown features: `[[wikilinks]]`, `![[embeds]]`, YAML frontmatter, tags, and callouts.
- If you are uncertain which file/section to modify, re-check `.obsidian/ai-context.json` and proceed using the priority: selection → current heading → whole note.

## Quick checklist (do this every time)

- [ ] Read `.obsidian/ai-context.json`
- [ ] Use the active file as default target if no path specified
- [ ] Prefer selection → current heading section → whole note
- [ ] If generating a new note, write to `_generated/` and index it under "AI Outputs"
- [ ] Only open/show notes in Obsidian when the user explicitly asks
- [ ] For placement tasks: tree → bounded DFS → propose options / ask about reorg/new folder
