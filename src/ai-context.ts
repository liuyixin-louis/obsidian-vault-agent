/* eslint-disable sort-imports, indent, no-negated-condition */
import { createHash } from "node:crypto"
import { JSON_STRINGIFY_SPACE } from "@polyipseity/obsidian-plugin-library"
import { debounce } from "lodash-es"
import {
	FileSystemAdapter,
	TFile,
	TFolder,
	type CachedMetadata,
	type DataAdapter,
	type HeadingCache,
	type TAbstractFile,
} from "obsidian"
import type { TerminalPlugin } from "./main.js"

const CONTEXT_PATH = ".obsidian/ai-context.json",
	CONTEXT_TEMP_SUFFIX = ".tmp",
	CONTEXT_DEBOUNCE_MS = 200,
	MAX_TREE_DEPTH = 2,
	MAX_TREE_NODES = 200,
	MAX_SELECTION_LENGTH = 8_000

interface AIContextPayload {
	readonly activeFileVaultPath: string | null
	readonly activeFolderVaultPath: string | null
	readonly activeFileSystemPath: string | null
	readonly activeFolderSystemPath: string | null
	readonly updatedAt: string
	readonly activeFolderBreadcrumb: FolderBreadcrumbEntry[]
	readonly activeFolderTree: FolderTree | null
	readonly activeHeadingPath: readonly string[] | null
	readonly cursorLine: number | null
	readonly cursorCh: number | null
	readonly selectionText?: string | null
}

interface FolderBreadcrumbEntry {
	readonly vaultPath: string
	readonly name: string
}

interface FolderTree {
	readonly vaultPath: string
	readonly name: string
	readonly type: "file" | "folder"
	readonly children?: FolderTree[]
	readonly truncated?: boolean
	readonly limits?: {
		readonly maxDepth: number
		readonly maxNodes: number
	}
}

interface FolderTreeMutable {
	children: FolderTreeMutable[]
	limits?: FolderTree["limits"]
	name: string
	truncated?: boolean
	type: "file" | "folder"
	vaultPath: string
}

function hashString(content: string): string {
	return createHash("sha1").update(content).digest("hex")
}

function toSystemPath(
	adapter: FileSystemAdapter | null,
	file: TAbstractFile | null,
): string | null {
	if (!adapter || !file) { return null }
	return adapter.getFullPath(file.path)
}

function buildBreadcrumb(folder: TFolder): FolderBreadcrumbEntry[] {
	const parts: FolderBreadcrumbEntry[] = []
	let cur: TFolder | null = folder
	while (cur) {
		parts.push({ name: cur.name, vaultPath: cur.path })
		cur = cur.parent
	}
	return parts.reverse()
}

function sanitizeSelection(
	editor: { getSelection: () => string; somethingSelected: () => boolean },
): string | null {
	if (!editor.somethingSelected()) { return null }
	const selection = editor.getSelection()
	if (!selection) { return null }
	return selection.length > MAX_SELECTION_LENGTH
		? selection.slice(0, MAX_SELECTION_LENGTH)
		: selection
}

function resolveHeadingPath(
	cache: CachedMetadata | null | undefined,
	cursorLine: number | null,
): string[] | null {
	if (!cache || cursorLine === null) { return null }
	const { headings } = cache
	if (!headings || headings.length === 0) { return [] }
	const stack: HeadingCache[] = []
	for (const heading of headings) {
		if (heading.position.start.line > cursorLine) { break }
		while (stack.length > 0) {
			const prev = stack[stack.length - 1]
			if (prev && heading.level <= prev.level) {
				stack.pop()
			} else {
				break
			}
		}
		stack.push(heading)
	}
	return stack.map(item => item.heading)
}

function buildFolderTree(
	root: TFolder,
	files: readonly TAbstractFile[],
): FolderTree {
	const rootPath = root.path,
		limits = { maxDepth: MAX_TREE_DEPTH, maxNodes: MAX_TREE_NODES },
		rootNode: FolderTreeMutable = {
			children: [],
			limits,
			name: root.name,
			truncated: false,
			type: "folder",
			vaultPath: rootPath,
		}
	let nodes = 1,
		truncated = false
	for (const file of files) {
		if (nodes >= MAX_TREE_NODES) {
			truncated = true
			break
		}
		if (!file.path.startsWith(rootPath)) { continue }
		const rel = file.path.slice(rootPath.length).replace(/^\//u, "")
		if (!rel) { continue }
		const segments = rel.split("/")
		if (segments.length > MAX_TREE_DEPTH + 1) {
			rootNode.truncated = true
			continue
		}
		let cursor: FolderTreeMutable = rootNode
		for (let idx = 0; idx < segments.length && !truncated; idx++) {
			const segment = segments[idx] ?? "",
				atLeaf = idx === segments.length - 1,
				vaultPath = `${cursor.vaultPath}/${segment}`,
				type = atLeaf
					? file instanceof TFolder ? "folder" : "file"
					: "folder"
			let child: FolderTreeMutable | undefined =
				cursor.children.find(entry => entry.name === segment)
			if (!child) {
				child = {
					children: [],
					name: segment,
					type,
					vaultPath,
				}
				cursor.children.push(child)
				nodes += 1
				if (nodes >= MAX_TREE_NODES) {
					truncated = true
					break
				}
			}
			if (!atLeaf && child.type === "folder") {
				cursor = child
			} else if (!atLeaf) {
				break
			}
		}
	}
	if (truncated) { rootNode.truncated = true }
	const toFolderTree = (node: FolderTreeMutable): FolderTree => {
		const { limits: limitsCur, truncated: truncatedCur } = node,
			base: FolderTree = {
				...(limitsCur ? { limits: limitsCur } : {}),
				...(truncatedCur !== void 0 ? { truncated: truncatedCur } : {}),
				name: node.name,
				type: node.type,
				vaultPath: node.vaultPath,
			}
		if (node.children.length === 0) {
			return base
		}
		return {
			...base,
			children: node.children.map(toFolderTree),
		}
	}
	return toFolderTree(rootNode)
}

function getExplorerFolder(plugin: TerminalPlugin): TFolder | null {
	const [explorerLeaf] = plugin.app.workspace.getLeavesOfType("file-explorer"),
		explorer = explorerLeaf?.view,
		selection: TAbstractFile[] = isExplorer(explorer)
			? explorer.getSelection() ?? []
			: []
	for (const item of selection) {
		if (item instanceof TFolder) { return item }
	}
	const file = selection.find((item: TAbstractFile): item is TFile =>
		item instanceof TFile)
	return file?.parent ?? null
}

function isExplorer(
	view: unknown,
): view is { getSelection: () => TAbstractFile[] | null | undefined } {
	return typeof view === "object"
		&& view !== null
		&& "getSelection" in view
		&& typeof (view as { getSelection: unknown }).getSelection === "function"
}

function buildPayload(
	plugin: TerminalPlugin,
	cache: {
		lastFolderPath: string | null
		lastBreadcrumb: FolderBreadcrumbEntry[]
		lastTree: FolderTree | null
	},
): {
	payload: AIContextPayload | null
	lastFolderPath: string | null
	lastBreadcrumb: FolderBreadcrumbEntry[]
	lastTree: FolderTree | null
} {
	const { app } = plugin,
		{ metadataCache, workspace, vault } = app,
		adapter = vault.adapter instanceof FileSystemAdapter
			? vault.adapter
			: null,
		activeEditor = workspace.activeEditor,
		activeFile = activeEditor?.file ?? workspace.getActiveFile(),
		editor = activeEditor?.editor,
		cursorHead = editor?.getCursor("head") ?? null,
		cursorLine = cursorHead?.line ?? null,
		cursorCh = cursorHead?.ch ?? null,
		selectionText = editor ? sanitizeSelection(editor) : null,
		activeHeadingPath = activeFile && cursorHead
			? resolveHeadingPath(
				metadataCache.getFileCache(activeFile),
				cursorHead.line,
			)
			: null,
		activeFolder = activeFile?.parent ?? getExplorerFolder(plugin),
		activeFolderPath = activeFolder?.path ?? null,
		folderChanged = activeFolderPath !== cache.lastFolderPath
	if (!activeFile && !activeFolder) {
		return {
			lastBreadcrumb: cache.lastBreadcrumb,
			lastFolderPath: cache.lastFolderPath,
			lastTree: cache.lastTree,
			payload: null,
		}
	}
	const breadcrumb = activeFolder
			? folderChanged ? buildBreadcrumb(activeFolder) : cache.lastBreadcrumb
			: [],
		activeFolderTree = activeFolder
			? folderChanged
				? buildFolderTree(
					activeFolder,
					vault.getAllLoadedFiles(),
				)
				: cache.lastTree
			: null,
		payload: AIContextPayload = {
			activeHeadingPath,
			cursorCh,
			cursorLine,
			activeFileSystemPath: toSystemPath(adapter, activeFile),
			activeFileVaultPath: activeFile?.path ?? null,
			activeFolderBreadcrumb: breadcrumb,
			activeFolderSystemPath: toSystemPath(adapter, activeFolder),
			activeFolderTree,
			activeFolderVaultPath: activeFolder?.path ?? null,
			...(selectionText ? { selectionText } : {}),
			updatedAt: new Date().toISOString(),
		}
	return {
		lastBreadcrumb: breadcrumb,
		lastFolderPath: activeFolderPath,
		lastTree: activeFolderTree,
		payload,
	}
}

async function writeAtomic(
	adapter: DataAdapter,
	serialized: string,
): Promise<void> {
	const tmpPath = `${CONTEXT_PATH}${CONTEXT_TEMP_SUFFIX}`
	try {
		await adapter.write(tmpPath, serialized)
		if (typeof adapter.rename === "function") {
			try {
				await adapter.remove(CONTEXT_PATH)
			} catch {
				// Ignore if destination doesn't exist
			}
			await adapter.rename(tmpPath, CONTEXT_PATH)
			return
		}
		throw new Error("adapter.rename is not available")
	} catch (error) {
		self.console.error(error)
		try {
			await adapter.write(CONTEXT_PATH, serialized)
		} catch (fallbackError) {
			self.console.error(fallbackError)
		}
	}
}

function withErrorBarrier<T extends unknown[]>(
	cb: (...args: T) => void | Promise<void>,
): (...args: T) => void {
	return (...args: T): void => {
		void Promise.resolve()
			.then(() => cb(...args))
			.catch(error => { self.console.error(error) })
	}
}

export function loadAIContext(plugin: TerminalPlugin): void {
	let lastWrittenHash = "",
		lastFolderPath: string | null = null,
		lastBreadcrumb: FolderBreadcrumbEntry[] = [],
		lastTree: FolderTree | null = null
	const { app } = plugin,
		writeContext = debounce(async () => {
			try {
				const {
						payload,
						lastBreadcrumb: bc,
						lastFolderPath: fp,
						lastTree: tree,
					} = buildPayload(
						plugin,
						{ lastBreadcrumb, lastFolderPath, lastTree },
					)
				if (!payload) { return }
				lastBreadcrumb = bc
				lastFolderPath = fp
				lastTree = tree
				const serialized = JSON.stringify(payload, null, JSON_STRINGIFY_SPACE),
					serializedHash = hashString(serialized)
				if (serializedHash === lastWrittenHash) { return }
				await writeAtomic(app.vault.adapter, serialized)
				lastWrittenHash = serializedHash
			} catch (error) {
				self.console.error(error)
			}
		}, CONTEXT_DEBOUNCE_MS),
		trigger = withErrorBarrier(() => { void writeContext() })

	plugin.register(() => { writeContext.cancel() })
	plugin.registerEvent(app.workspace.on("file-open", trigger))
	plugin.registerEvent(app.workspace.on("active-leaf-change", trigger))
	plugin.registerEvent(app.workspace.on("editor-change", trigger))
	plugin.registerInterval(self.setInterval(trigger, 1_000))
	trigger()
}
