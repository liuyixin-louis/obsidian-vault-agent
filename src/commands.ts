import { execFile } from "child_process"
import {
	FileSystemAdapter,
	MarkdownView,
	Notice,
	type Editor,
	type TFile,
} from "obsidian"
import type { TerminalPlugin } from "./main.js"

function normalizeSelection(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/[\u200B-\u200D\uFEFF]/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n(?:[ \t]*\n)+/g, "\n\n")
		.replace(/\n+$/g, "")
}

function buildPythonFence(content: string): string {
	const body = normalizeSelection(content)
	const middle = body ? `${body}\n` : ""
	return `\`\`\`python\n${middle}\`\`\`\n`
}

function focusInsideFence(editor: Editor, startLine: number): void {
	editor.setCursor({ ch: 0, line: startLine + 1 })
}

const AUTO_OPEN_MIN_INTERVAL_MS = 800

let lastActiveMarkdownFile: TFile | null = null,
	lastOpenedPath: string | null = null,
	lastOpenedAt = 0

function getCurrentMarkdownFile(plugin: TerminalPlugin): TFile | null {
	const { workspace } = plugin.app
	return workspace.getActiveFile()
		?? workspace.activeEditor?.file
		?? workspace.getActiveViewOfType(MarkdownView)?.file
		?? lastActiveMarkdownFile
}

function openInTypora(fullPath: string): void {
	const platform = process.platform
	const onError = (error: Error | null): void => {
		if (error) {
			new Notice(`Failed to open in Typora: ${error.message}`)
		}
	}

	if (platform === "darwin") {
		execFile("open", ["-g", "-a", "Typora", fullPath], onError)
		return
	}

	if (platform === "win32") {
		execFile(
			"cmd",
			["/c", "start", "", "Typora", `"${fullPath}"`],
			{ windowsHide: true },
			onError,
		)
		return
	}

	execFile("typora", [fullPath], error => {
		if (!error) { return }
		execFile("xdg-open", [fullPath], onError)
	})
}

function tryOpenFileInTypora(
	plugin: TerminalPlugin,
	file: TFile | null,
	{ force, notifyOnError }: { force: boolean; notifyOnError: boolean },
): void {
	if (!file) {
		if (notifyOnError) {
			new Notice("No active markdown note.")
		}
		return
	}
	if (file.extension !== "md") {
		if (notifyOnError) {
			new Notice("Active file is not a .md note.")
		}
		return
	}

	const adapter = plugin.app.vault.adapter
	if (!(adapter instanceof FileSystemAdapter)) {
		if (notifyOnError) {
			new Notice("Not a filesystem vault (mobile / unsupported).")
		}
		return
	}

	const fullPath = adapter.getFullPath(file.path)
	if (!fullPath) {
		if (notifyOnError) {
			new Notice("Failed to resolve full path.")
		}
		return
	}

	if (!force) {
		const now = Date.now()
		if (fullPath === lastOpenedPath) { return }
		if (now - lastOpenedAt < AUTO_OPEN_MIN_INTERVAL_MS) { return }
	}

	lastOpenedPath = fullPath
	lastOpenedAt = Date.now()
	openInTypora(fullPath)
}

function openActiveNoteInTypora(plugin: TerminalPlugin): void {
	const file = getCurrentMarkdownFile(plugin)
	tryOpenFileInTypora(plugin, file, { force: true, notifyOnError: true })
}

export function loadCommands(plugin: TerminalPlugin): void {
	plugin.registerEvent(plugin.app.workspace.on("file-open", file => {
		if (file?.extension === "md") {
			lastActiveMarkdownFile = file
		}
		if (!plugin.settings.value.autoOpenTyporaOnFileOpen) { return }
		tryOpenFileInTypora(plugin, file ?? null, {
			force: false,
			notifyOnError: false,
		})
	}))
	plugin.addCommand({
		id: "insert-python-fence",
		name: "Insert Python code block",
		editorCallback: (editor: Editor) => {
			const hasSelection = editor.somethingSelected(),
				selection = hasSelection ? editor.getSelection() : "",
				fence = buildPythonFence(selection),
				cursor = editor.getCursor()

			editor.replaceSelection(fence)
			if (!hasSelection) {
				focusInsideFence(editor, cursor.line)
			}
		},
	})

	plugin.addCommand({
		id: "open-active-note-in-typora",
		name: "Open active note in Typora",
		callback: () => { openActiveNoteInTypora(plugin) },
	})
}
