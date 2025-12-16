# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript sources; `main.ts` is the Obsidian entry, `terminal/` holds emulator logic and Python helpers (`unix_pseudoterminal.py`, `win32_resizer.py`), `@types/` defines plugin typings, and `settings*.ts`/`modals.ts` manage UI flows.
- `assets/`: images used in the README and manifests.
- `build/`: esbuild + packaging scripts (`build.mjs`, `obsidian-install.mjs`, version helpers). Do not edit generated `main.js` directly; change `src/` and rebuild.
- `.changeset/`: release notes; add a new file per PR.
- `styles.css`, `manifest*.json`, `requirements.txt`: shipped plugin assets; keep in sync with code changes.

## Build, Test, and Development Commands
- `npm install`: install dependencies (workspace-aware).
- `npm run dev`: incremental build for rapid iteration.
- `npm run check`: type-checks (`tsc --noEmit`) and lints via ESLint.
- `npm run build`: runs `check` then emits production `main.js`/`styles.css`.
- `npm run obsidian:install <vault>`: build then copy plugin files into the target Obsidian vault (example vault path: `/Users/yixinliu/Library/Mobile Documents/iCloud~md~obsidian/Documents/kobo-note/.obsidian/plugins/terminal-ai`).
- `npm run fix`: auto-fix lintable issues; re-run `npm run check` afterward.

## Coding Style & Naming Conventions
- Language: strict TypeScript + ESM; code lives in `src/`.
- Formatting: tabs for indentation, 80-character max line length, trailing commas on multiline lists, and arrow parens only when needed (see `eslint.config.mjs`). No Prettier.
- Naming: PascalCase for classes/components, camelCase for functions/variables, SCREAMING_SNAKE_CASE for constants. Prefer named exports; group helper utilities in `util.ts` files.
- Keep type-only imports explicit (`import type`) and favor readonly/immutable patterns already present in the codebase.

## Testing Guidelines
- Automated coverage is limited; default to `npm run check`.
- For functional verification, install to a test vault (`npm run obsidian:install <vault>`) and confirm integrated/external terminals, profile presets, and AI context helpers still behave as expected on your OS.
- When changing Python helpers or platform-specific spawns, test on the relevant platform or call out gaps in the PR.

## Commit & Pull Request Guidelines
- Commits: short, imperative subjects (e.g., “Fix profile pane sizing”); keep related changes together.
- Before opening a PR: run `npm run check` and `npm run build`; note any manual testing performed.
- Include a changeset under `.changeset/` describing the change and linking the PR/author per the README example.
- PRs should summarize intent, list user-visible changes, note platform coverage, and attach screenshots for UI or style updates. Link related issues when applicable.
