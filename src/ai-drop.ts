/* eslint-disable sort-imports */
import {
	JSON_STRINGIFY_SPACE,
	notice2,
} from "@polyipseity/obsidian-plugin-library"
import {
	FileSystemAdapter,
	type TAbstractFile,
} from "obsidian"
import type { TerminalPlugin } from "./main.js"

const DROP_PATH = ".obsidian/ai-drop.json"
let dropSeq = 0

interface DropPayload {
	paths: string[]
	vaultPaths?: string[]
	updatedAt: string
}

const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|\/|~[/\\])/u,
	DROP_SOURCE = {
		files: "files",
		plainText: "text/plain",
		uriList: "text/uri-list",
	} as const
type DropSource = typeof DROP_SOURCE[keyof typeof DROP_SOURCE]

function toSystemPath(
	adapter: FileSystemAdapter | null,
	file: TAbstractFile | null,
): string | null {
	if (!adapter || !file) { return null }
	return adapter.getFullPath(file.path)
}

function extractPathsFromDataTransfer(
	dt: DataTransfer,
): { paths: string[]; source: DropSource | null } {
	const fromFiles = extractFromFiles(dt)
	if (fromFiles.length) {
		return { paths: fromFiles, source: DROP_SOURCE.files }
	}
	const fromUriList = extractFromUriList(dt)
	if (fromUriList.length) {
		return { paths: fromUriList, source: DROP_SOURCE.uriList }
	}
	const fromPlain = extractFromPlainText(dt)
	return {
		paths: fromPlain,
		source: fromPlain.length ? DROP_SOURCE.plainText : null,
	}
}

function extractFromFiles(dt: DataTransfer): string[] {
	const paths = new Set<string>()
	for (const file of Array.from(dt.files)) {
		const { path } = file
		if (typeof path === "string" && path.length > 0) { paths.add(path) }
	}
	return Array.from(paths)
}

function extractFromUriList(dt: DataTransfer): string[] {
	const paths = new Set<string>(),
		uriList = dt.getData(DROP_SOURCE.uriList)
	if (!uriList) { return [] }
	for (const line of uriList.split("\n")) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#")) { continue }
		try {
			const url = new URL(trimmed)
			if (url.protocol === "file:") {
				const decoded = decodeURI(url.pathname)
				paths.add(decoded)
			}
		} catch {
			/* Ignore parse errors for malformed URI lines. */
		}
	}
	return Array.from(paths)
}

function extractFromPlainText(dt: DataTransfer): string[] {
	const paths = new Set<string>(),
		plain = dt.getData(DROP_SOURCE.plainText)
	if (!plain) { return [] }
	const trimmed = plain.trim()
	let parsed: unknown = null
	if (trimmed.startsWith("[")) {
		try { parsed = JSON.parse(trimmed) } catch {
			/* Ignore parse errors for JSON arrays. */
		}
	}
	if (Array.isArray(parsed)) {
		for (const val of parsed) {
			if (typeof val === "string" && PATH_LIKE.test(val)) {
				paths.add(val)
			}
		}
	}
	if (!paths.size) {
		for (const piece of trimmed.split(/\s+/u)) {
			const maybe = piece.trim()
			if (maybe.startsWith("file://")) {
				try {
					const url = new URL(maybe)
					if (url.protocol === "file:") {
						paths.add(decodeURI(url.pathname))
						continue
					}
				} catch {
					// Fall through.
				}
			}
			if (PATH_LIKE.test(maybe)) { paths.add(maybe) }
		}
	}
	return Array.from(paths)
}

function vaultPathsFromAbsolutes(
	plugin: TerminalPlugin,
	paths: readonly string[],
): string[] {
	const { app: { vault } } = plugin,
		adapter = vault.adapter instanceof FileSystemAdapter
			? vault.adapter
			: null
	if (!adapter) { return [] }
	const base = adapter.getBasePath()
	return paths
		.map(path => path.startsWith(base) ? path.slice(base.length + 1) : null)
		.filter((vaultPath): vaultPath is string => Boolean(vaultPath))
}

export async function handleDrop(
	plugin: TerminalPlugin,
	terminal: import("@xterm/xterm").Terminal,
	event: DragEvent,
): Promise<void> {
	const {
			app,
			settings,
		} = plugin,
		{ dataTransfer } = event,
		debug = settings.value.debugDropLogging,
		seq = ++dropSeq
	if (!dataTransfer) { return }
	const { paths: abs, source } = extractPathsFromDataTransfer(dataTransfer),
		ready = Boolean(terminal.element?.isConnected),
		types = Array.from(dataTransfer.types)
	if (debug) {
		self.console.log("plugin:terminal-ai:drop", {
			paths: abs,
			ready,
			seq,
			source,
			types,
		})
	}
	if (!abs.length) {
		notice2(
			() => "Couldn’t resolve drop data; use right-click ‘Send to terminal’",
			plugin.settings.value.errorNoticeTimeout,
			plugin,
		)
		return
	}
	const payload: DropPayload = {
		paths: abs,
		updatedAt: new Date().toISOString(),
	},
		vaultPaths = vaultPathsFromAbsolutes(plugin, abs)
	if (vaultPaths.length) { payload.vaultPaths = vaultPaths }
	await app.vault.adapter.write(
		DROP_PATH,
		JSON.stringify(payload, null, JSON_STRINGIFY_SPACE),
	)
	if (!ready) {
		notice2(
			() => "Paths saved. Focus a terminal then run Insert last dropped paths.",
			plugin.settings.value.noticeTimeout,
			plugin,
		)
		return
	}
	try {
		terminal.paste(JSON.stringify(abs))
	} catch (error) {
		notice2(
			() => String(error),
			plugin.settings.value.errorNoticeTimeout,
			plugin,
		)
	}
}

export async function sendSelectionToDrop(
	plugin: TerminalPlugin,
	files: readonly TAbstractFile[],
): Promise<DropPayload | null> {
	const { app } = plugin,
		adapter = app.vault.adapter instanceof FileSystemAdapter
			? app.vault.adapter
			: null
	if (!files.length) { return null }
	const abs = files
		.map(file => toSystemPath(adapter, file))
		.filter((path): path is string => Boolean(path))
	if (!abs.length) { return null }
	const payload: DropPayload = {
		paths: abs,
		updatedAt: new Date().toISOString(),
	},
		vaultPaths = vaultPathsFromAbsolutes(plugin, abs)
	if (vaultPaths.length) { payload.vaultPaths = vaultPaths }
	await app.vault.adapter.write(
		DROP_PATH,
		JSON.stringify(payload, null, JSON_STRINGIFY_SPACE),
	)
	return payload
}

export async function insertLastDroppedPaths(
	plugin: TerminalPlugin,
	terminal: import("@xterm/xterm").Terminal | null,
): Promise<boolean> {
	if (!terminal) { return false }
	const ready = Boolean(terminal.element?.isConnected)
	if (!ready) {
		notice2(
			() => "Terminal not ready; focus a terminal view and retry.",
			plugin.settings.value.noticeTimeout,
			plugin,
		)
		return false
	}
	try {
		const raw = await plugin.app.vault.adapter.read(DROP_PATH),
			parsed: unknown = JSON.parse(raw)
		if (parsed === null || typeof parsed !== "object") { return false }
		const rawPaths = (parsed as { paths?: unknown }).paths
		if (!Array.isArray(rawPaths)) { return false }
		const paths = rawPaths.filter(
			(path): path is string => typeof path === "string",
		)
		if (paths.length === 0) { return false }
		terminal.paste(JSON.stringify(paths))
		return true
	} catch (error) {
		notice2(
			() => String(error),
			plugin.settings.value.errorNoticeTimeout,
			plugin,
		)
		return false
	}
}
