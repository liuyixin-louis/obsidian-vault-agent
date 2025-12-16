import type { TerminalPlugin } from "./main.js"
import {
	FileSystemAdapter,
	normalizePath,
	TAbstractFile,
	TFolder,
} from "obsidian"

const
	DEFAULT_ATTEMPTS = 6,
	DEFAULT_DELAY_MS = 30

type ExplorerItem = Record<string, unknown> & {
	file?: TAbstractFile | null
	setCollapsed?: (collapsed: boolean) => void
	collapse?: () => void
	expand?: () => void
	path?: string
}
type ExplorerView = {
	readonly containerEl: HTMLElement
	readonly fileItems?: Map<string, ExplorerItem> | Record<string, ExplorerItem>
	revealFile?: (file: TAbstractFile) => void
	revealInFolder?: (file: TAbstractFile) => void
}

export interface ExplorerFocusOptions {
	readonly attempts?: number
	readonly center?: ScrollLogicalPosition
	readonly collapseIrrelevant?: boolean
	readonly delayMs?: number
}

export function normalizeVaultPath(
	plugin: TerminalPlugin,
	rawPath: string,
): string | null {
	const trimmed = rawPath.trim()
	if (!trimmed) { return null }
	const unquoted = trimmed
		.replace(/^["'`]/u, "")
		.replace(/["'`]$/u, "")
	let normalized: string
	try {
		normalized = normalizePath(unquoted.replace(/\\/gu, "/"))
	} catch (error) {
		self.console.warn("[terminal-ai] Failed to normalize path", error)
		return null
	}
	if (!normalized) { return null }
	const { vault: { adapter } } = plugin.app
	if (adapter instanceof FileSystemAdapter) {
		const base = adapter.getBasePath().replace(/\\/gu, "/")
		if (normalized.replace(/\\/gu, "/").startsWith(base)) {
			return normalized.slice(base.length).replace(/^[/\\]+/u, "")
		}
	}
	return normalized.replace(/^[/\\]+/u, "")
}

export async function revealInExplorer(
	plugin: TerminalPlugin,
	target: TAbstractFile,
	{
		attempts = DEFAULT_ATTEMPTS,
		center = "center",
		collapseIrrelevant = false,
		delayMs = DEFAULT_DELAY_MS,
	}: ExplorerFocusOptions = {},
): Promise<boolean> {
	const explorer = getExplorer(plugin)
	if (!explorer) { return false }
	reveal(explorer, target)
	const keepPaths = collapseIrrelevant ? collectAncestorPaths(target) : null
	return new Promise(resolve => {
		let remaining = attempts
		const focus = (): void => {
			const item = findItem(explorer, target.path)
			if (keepPaths) {
				collapseFolders(explorer, keepPaths)
			}
			const element = getItemElement(explorer, item, target)
				?? queryDomFallback(explorer, target)
			if (element) {
				element.scrollIntoView({ block: center, inline: "nearest" })
				resolve(true)
				return
			}
			if (remaining-- <= 0) {
				resolve(false)
				return
			}
			self.requestAnimationFrame(focus)
		}
		self.setTimeout(focus, delayMs)
	})
}

export function resolveAbstractFile(
	plugin: TerminalPlugin,
	vaultPath: string,
): TAbstractFile | null {
	const resolved = vaultPath.replace(/[/\\]+$/u, "")
	return plugin.app.vault.getAbstractFileByPath(resolved) ?? null
}

function reveal(explorer: ExplorerView, target: TAbstractFile): void {
	try {
		if (typeof explorer.revealInFolder === "function") {
			explorer.revealInFolder(target)
			return
		}
		if (typeof explorer.revealFile === "function") {
			explorer.revealFile(target)
		}
	} catch (error) {
		self.console.warn("[terminal-ai] Failed to reveal target", error)
	}
}

function getExplorer(plugin: TerminalPlugin): ExplorerView | null {
	const [leaf] = plugin.app.workspace.getLeavesOfType("file-explorer")
	return (leaf?.view as ExplorerView) ?? null
}

function findItem(
	explorer: ExplorerView,
	path: string,
): ExplorerItem | null {
	const { fileItems } = explorer
	if (!fileItems) { return null }
	if (fileItems instanceof Map) {
		return fileItems.get(path) ?? null
	}
	if (path in fileItems) {
		return fileItems[path] ?? null
	}
	return null
}

function getItemElement(
	explorer: ExplorerView,
	item: ExplorerItem | null,
	target: TAbstractFile,
): HTMLElement | null {
	if (!item) { return null }
	const candidateKeys = [
		"selfEl",
		"el",
		"titleEl",
		"containerEl",
		"innerEl",
		"contentEl",
		"titleInnerEl",
		"outerEl",
	]
	for (const key of candidateKeys) {
		const maybe = item[key as keyof ExplorerItem]
		if (maybe instanceof HTMLElement) { return maybe }
	}
	const path = target.path
	return queryDomFallback(explorer, target, path)
}

function queryDomFallback(
	explorer: ExplorerView,
	target: TAbstractFile,
	path = target.path,
): HTMLElement | null {
	const { containerEl } = explorer
	if (!containerEl) { return null }
	try {
		const escaped = typeof CSS !== "undefined"
			&& CSS.escape
			? CSS.escape(path)
			: path.replace(/"/gu, "\\\""),
			selectors = target instanceof TFolder
				? [
					`.nav-folder-title[data-path="${escaped}"]`,
					`.nav-folder[data-path="${escaped}"]`,
				]
				: [
					`.nav-file-title[data-path="${escaped}"]`,
					`.nav-file[data-path="${escaped}"]`,
				]
		for (const selector of selectors) {
			const element = containerEl.querySelector(selector)
			if (element instanceof HTMLElement) { return element }
		}
	} catch (error) {
		self.console.warn("[terminal-ai] Failed to query explorer DOM", error)
	}
	return null
}

function collectAncestorPaths(target: TAbstractFile): Set<string> {
	const paths = new Set<string>()
	let cursor: TFolder | null = target instanceof TFolder ? target : target.parent
	while (cursor) {
		paths.add(cursor.path)
		cursor = cursor.parent
	}
	return paths
}

function collapseFolders(
	explorer: ExplorerView,
	keep: Set<string>,
): void {
	const { fileItems } = explorer
	if (!fileItems) { return }
	const collapse = (item: ExplorerItem, collapsed: boolean): void => {
		if (typeof item.setCollapsed === "function") {
			item.setCollapsed(collapsed)
			return
		}
		if (collapsed && typeof item.collapse === "function") {
			item.collapse()
			return
		}
		if (!collapsed && typeof item.expand === "function") {
			item.expand()
		}
	}
	const entries = fileItems instanceof Map
		? fileItems.values()
		: Object.values(fileItems)
	for (const item of entries) {
		if (!item) { continue }
		const file = item.file,
			path = typeof item.path === "string" ? item.path : file?.path
		if (!(file instanceof TFolder) || !path) { continue }
		if (keep.has(path)) {
			collapse(item, false)
		} else {
			collapse(item, true)
		}
	}
}
