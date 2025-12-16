/* eslint-disable sort-imports */
import { notice2, Platform } from "@polyipseity/obsidian-plugin-library"
import { FileSystemAdapter } from "obsidian"
import { Settings } from "./settings-data.js"
import { TerminalView } from "./terminal/view.js"
import type { TerminalPlugin } from "./main.js"

const
	BUTTON_ID = "terminal-ai-open-root",
	BUTTON_ID_CODEX = "terminal-ai-open-codex",
	BUTTON_ID_CC = "terminal-ai-open-cc",
	// Run the commands directly instead of defining aliases
	COMMAND_ZSH = "zsh",
	COMMAND_CODEX = "codex",
	COMMAND_CC = "claude --dangerously-skip-permissions"

function buildBaseState(plugin: TerminalPlugin): TerminalView.State | null {
	const { app: { vault }, language: { value: i18n }, settings } = plugin,
		adapter = vault.adapter instanceof FileSystemAdapter ? vault.adapter : null,
		cwd = adapter ? adapter.getBasePath() : ""
	if (!cwd) { return null }
	const profile = Settings.Profile.defaultOfType(
		"integrated",
		settings.value.profiles,
		Platform.CURRENT,
	)
	if (!profile) {
		notice2(
			() => i18n.t("notices.no-default-profile", {
				interpolation: { escapeValue: false },
				type: "integrated",
			}),
			settings.value.errorNoticeTimeout,
			plugin,
		)
		return null
	}
	return {
		cwd,
		focus: settings.value.focusOnNewInstance,
		initialCommands: [],
		profile,
		serial: null,
	}
}

async function openVaultRootTerminal(
	plugin: TerminalPlugin,
	initialCommands: readonly string[] = [],
): Promise<void> {
	const base = buildBaseState(plugin)
	if (!base) { return }
	const leaf = plugin.app.workspace.getLeaf(false),
		state = {
			...base,
			initialCommands: initialCommands.length ? [...initialCommands] : [],
		}
	await TerminalView.spawn(plugin, state, leaf)
}

function attachButton(plugin: TerminalPlugin): void {
	const doc = plugin.app.workspace.containerEl.ownerDocument,
		empties = Array.from(doc.querySelectorAll(".empty-state"))
	empties.forEach(empty => {
		const target = empty.querySelector(".empty-state-cta") ?? empty
		if (!target.querySelector(`#${BUTTON_ID}`)) {
			const btn = doc.createElement("button")
			btn.id = BUTTON_ID
			btn.classList.add("terminal-ai-open-root-btn")
			btn.textContent = "zsh"
			btn.addEventListener("click", () => {
				void openVaultRootTerminal(plugin, [COMMAND_ZSH])
			})
			target.prepend(btn)
		}
		if (!target.querySelector(`#${BUTTON_ID_CODEX}`)) {
			const btn = doc.createElement("button")
			btn.id = BUTTON_ID_CODEX
			btn.classList.add("terminal-ai-open-root-btn")
			btn.textContent = "codex"
			btn.addEventListener("click", () => {
				void openVaultRootTerminal(plugin, [COMMAND_CODEX])
			})
			target.prepend(btn)
		}
		if (!target.querySelector(`#${BUTTON_ID_CC}`)) {
			const btn = doc.createElement("button")
			btn.id = BUTTON_ID_CC
			btn.classList.add("terminal-ai-open-root-btn")
			btn.textContent = "cc"
			btn.addEventListener("click", () => {
				void openVaultRootTerminal(plugin, [COMMAND_CC])
			})
			target.prepend(btn)
		}
	})
}

export function loadNewTabButton(plugin: TerminalPlugin): void {
	const observer = new MutationObserver(() => { attachButton(plugin) })
	attachButton(plugin)
	observer.observe(
		plugin.app.workspace.containerEl.ownerDocument.body,
		{ childList: true, subtree: true },
	)
	plugin.register(() => { observer.disconnect() })
}
