import { TFile, type App, type Command } from "obsidian"
import type { TerminalPlugin } from "./main.js"
import { addCommand } from "@polyipseity/obsidian-plugin-library"
import { revealInExplorer } from "./file-explorer.js"
import {
	DualRevealHighlighter,
	findInFileExplorer,
	getFileExplorerRoot,
} from "./dual-reveal-highlighter.js"

const REVEAL_DELAY_MS = 50,
	HIGHLIGHT_DURATION_MS = 2000,
	REVEAL_COMMAND_IDS = [
		"make-md:mk-reveal-file",
		"notebook-navigator:reveal-file",
		"file-explorer:reveal-active-file",
	] as const

interface CommandManager {
	readonly commands: Record<string, Command>
	executeCommandById: (id: string) => void
}

export function loadRevealSync(context: TerminalPlugin): void {
	const { app, settings } = context,
		commandManager =
			(app as App & { commands?: CommandManager }).commands ?? null,
		highlighter = new DualRevealHighlighter()
	let lastRevealedPath: string | null = null,
		explorerUnregister: (() => void) | null = null

	const registerFileExplorer = (): void => {
		if (explorerUnregister) { return }
		const root = getFileExplorerRoot(app.workspace)
		if (!root) { return }
		explorerUnregister = highlighter.registerNavigator({
			findItemElByPath: findInFileExplorer,
			name: "file-explorer",
			root,
		})
	}

	const
		revealInAllNavigators = (
			file: TFile | null,
			{ force } = { force: false },
		): void => {
			if (!file || !commandManager) { return }
			if (!force && lastRevealedPath === file.path) { return }
			lastRevealedPath = file.path

			const { activeElement } = self.document,
				focusTarget = activeElement instanceof HTMLElement
					? activeElement
					: null,
				centerInExplorer = (): void => {
					if (!file) { return }
					void revealInExplorer(context, file, { center: "center" })
				}
			self.setTimeout(() => {
				for (const id of REVEAL_COMMAND_IDS) {
					if (!commandManager.commands[id]) { continue }
					try {
						const ret = commandManager.executeCommandById(id) as unknown
						if (ret instanceof Promise) {
							void ret.catch(error => {
								self.console.warn(
									`[terminal-ai] reveal failed (async): ${id}`,
									error,
								)
							})
						}
					} catch (error) {
						self.console.warn(`[terminal-ai] reveal failed: ${id}`, error)
					}
				}
				self.requestAnimationFrame(() => {
					centerInExplorer()
					focusTarget?.focus()

					if (settings.value.dualRevealHighlight) {
						registerFileExplorer()
						highlighter.setTargets(file.path, undefined, HIGHLIGHT_DURATION_MS)
					}
				})
			}, REVEAL_DELAY_MS)
		},
		revealActiveFile = ({ force } = { force: false }): boolean => {
			const file = app.workspace.getActiveFile()
			if (!file || !commandManager) { return false }
			revealInAllNavigators(file, { force })
			return true
		}

	context.registerEvent(app.workspace.on("file-open", file => {
		if (!settings.value.syncRevealOnFileOpen) { return }
		revealInAllNavigators(file)
	}))
	context.registerEvent(app.vault.on("create", file => {
		if (!settings.value.syncRevealOnFileOpen) { return }
		if (!(file instanceof TFile)) { return }
		if (app.workspace.getActiveFile()?.path !== file.path) { return }
		revealInAllNavigators(file, { force: true })
	}))
	context.register(settings.onMutate(
		settings0 => settings0.syncRevealOnFileOpen,
		enabled => { if (enabled) { lastRevealedPath = null } },
	))

	context.register(() => {
		highlighter.destroy()
		if (explorerUnregister) {
			explorerUnregister()
			explorerUnregister = null
		}
	})

	addCommand(
		context,
		() => "Terminal AI: Reveal current file in navigators",
		{
			checkCallback(checking) {
				if (checking) { return revealActiveFile() }
				return revealActiveFile({ force: true })
			},
			id: "reveal-in-navigators",
		},
	)
}
