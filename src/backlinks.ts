import type { App, TFile } from "obsidian"

interface BacklinksData {
	readonly data?: Record<string, LinkRef[]>
}

interface MetadataCacheWithBacklinks {
	getBacklinksForFile(file: TFile): BacklinksData | null
}

interface DomElementOptions {
	readonly cls?: string
	readonly href?: string
	readonly text?: string
}

interface ObsidianHTMLElement extends HTMLElement {
	createDiv(options?: DomElementOptions): ObsidianHTMLElement
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: DomElementOptions,
	): HTMLElementTagNameMap[K] & ObsidianHTMLElement
}

const DEFAULT_SNIPPET_WINDOW = 110,
	DEFAULT_MAX_SNIPPETS = 3

interface LinkRef {
	readonly position?: {
		readonly start?: {
			readonly offset?: number
			readonly line?: number
			readonly col?: number
		}
		readonly end?: {
			readonly offset?: number
			readonly line?: number
			readonly col?: number
		}
	}
}

export type BacklinkSortMode = "count" | "hybrid" | "recent"

export interface BacklinkMention {
	readonly count: number
	readonly file: TFile
	readonly lastOffset: number
	readonly mtime: number
	readonly snippets: readonly string[]
}

export interface BacklinkOptions {
	readonly maxSnippetsPerFile?: number
	readonly snippetWindow?: number
	readonly sortMode?: BacklinkSortMode
}

function clamp(num: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, num))
}

function normalizeSnippet(str: string): string {
	return str.replace(/\s+/gu, " ").trim()
}

function buildLineStartOffsets(text: string): number[] {
	const starts = [0]
	for (let idx = 0; idx < text.length; idx++) {
		if (text.charAt(idx) === "\n") {
			starts.push(idx + 1)
		}
	}
	return starts
}

function offsetFromLineCol(
	text: string,
	line?: number,
	col?: number,
): number | null {
	if (line === null || line === undefined ||
		col === null || col === undefined) {
		return null
	}
	const starts = buildLineStartOffsets(text),
		lineNum = clamp(line, 0, starts.length - 1),
		base = starts[lineNum] ?? 0
	return clamp(base + col, 0, text.length)
}

function getRefOffset(text: string, ref: LinkRef): number | null {
	const start = ref.position?.start
	if (!start) {
		return null
	}
	if (typeof start.offset === "number") {
		return clamp(start.offset, 0, text.length)
	}
	return offsetFromLineCol(text, start.line, start.col)
}

function extractContextSnippet(
	text: string,
	offset: number,
	window: number = DEFAULT_SNIPPET_WINDOW,
): string {
	const half = Math.floor(window / 2),
		start = clamp(offset - half, 0, text.length),
		end = clamp(offset + half, 0, text.length),
		prefix = start > 0 ? "... " : "",
		suffix = end < text.length ? " ..." : ""
	return prefix + normalizeSnippet(text.slice(start, end)) + suffix
}

export async function buildBacklinkMentions(
	app: App,
	target: TFile,
	opts: BacklinkOptions = {},
): Promise<BacklinkMention[]> {
	const sortMode = opts.sortMode ?? "recent",
		maxSnippetsPerFile = opts.maxSnippetsPerFile ?? DEFAULT_MAX_SNIPPETS,
		snippetWindow = opts.snippetWindow ?? DEFAULT_SNIPPET_WINDOW,
		cache = app.metadataCache as unknown as MetadataCacheWithBacklinks,
		backlinks = cache.getBacklinksForFile(target),
		data = (backlinks?.data ?? {}) as Record<string, LinkRef[]>,
		results: BacklinkMention[] = []

	for (const sourcePath of Object.keys(data)) {
		const abs = app.vault.getAbstractFileByPath(sourcePath)
		if (!abs || !("stat" in abs)) {
			continue
		}
		const file = abs as TFile,
			refs = data[sourcePath] ?? [],
			count = refs.length,
			mtime = file.stat?.mtime ?? 0

		let text = ""
		try {
			text = await app.vault.cachedRead(file)
		} catch {
			results.push({
				count,
				file,
				lastOffset: -1,
				mtime,
				snippets: [],
			})
			continue
		}

		const offsets: number[] = []
		for (const ref of refs) {
			const off = getRefOffset(text, ref)
			if (off !== null) {
				offsets.push(off)
			}
		}
		const lastOffset = offsets.length > 0 ? Math.max(...offsets) : -1

		offsets.sort((first, second) => first - second)

		const snippets: string[] = []
		for (
			let idx = 0;
			idx < offsets.length && snippets.length < maxSnippetsPerFile;
			idx++
		) {
			const off = offsets[idx]
			if (off !== undefined) {
				snippets.push(extractContextSnippet(text, off, snippetWindow))
			}
		}

		results.push({
			count,
			file,
			lastOffset,
			mtime,
			snippets,
		})
	}

	results.sort((first, second) => {
		if (sortMode === "count") {
			return (second.count - first.count) ||
				(second.mtime - first.mtime) ||
				(second.lastOffset - first.lastOffset)
		}
		return (second.mtime - first.mtime) ||
			(second.count - first.count) ||
			(second.lastOffset - first.lastOffset)
	})

	return results
}

function createPageIconElement(): HTMLElement {
	const span = document.createElement("span")
	span.className = "rel-page-icon"
	span.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
		<path fill="currentColor" d="M6 2h9l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5"/>
	</svg>`
	return span
}

export async function renderBacklinksWithPreviews(
	app: App,
	container: HTMLElement,
	target: TFile,
	opts: BacklinkOptions = {},
): Promise<void> {
	while (container.firstChild) {
		container.removeChild(container.firstChild)
	}

	const mentions = await buildBacklinkMentions(app, target, {
		maxSnippetsPerFile: opts.maxSnippetsPerFile ?? DEFAULT_MAX_SNIPPETS,
		snippetWindow: opts.snippetWindow ?? DEFAULT_SNIPPET_WINDOW,
		sortMode: opts.sortMode ?? "recent",
	})

	const root = container as ObsidianHTMLElement,
		list = root.createDiv({ cls: "rel-mentions-list" })

	for (const mention of mentions) {
		const card = list.createDiv({ cls: "rel-mention-card" }),
			header = card.createDiv({ cls: "rel-mention-header" })

		header.appendChild(createPageIconElement())

		const title = header.createEl("a", {
			cls: "rel-mention-title",
			href: "#",
			text: mention.file.basename,
		})

		const meta = header.createDiv({ cls: "rel-mention-meta" })
		meta.textContent = `${mention.count} mention${mention.count === 1 ? "" : "s"}`

		title.addEventListener("click", (ev: MouseEvent) => {
			ev.preventDefault()
			void app.workspace.getLeaf(true).openFile(mention.file)
		})

		if (mention.snippets.length > 0) {
			const snippetList = card.createEl("ul", { cls: "rel-mention-snippets" })
			for (const snippet of mention.snippets) {
				snippetList.createEl("li", {
					cls: "rel-mention-snippet",
					text: snippet,
				})
			}
		}
	}
}

export function getBacklinksStyles(): string {
	return `
.rel-mentions-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.rel-mention-card {
	padding: 10px;
	border-radius: 12px;
	border: 1px solid var(--background-modifier-border);
}

.rel-mention-header {
	display: flex;
	align-items: center;
	gap: 8px;
}

.rel-page-icon {
	display: inline-flex;
	opacity: 0.85;
}

.rel-mention-title {
	text-decoration: none;
	font-weight: 600;
}

.rel-mention-meta {
	margin-left: auto;
	opacity: 0.7;
	font-size: 12px;
}

.rel-mention-snippets {
	list-style: none;
	padding: 6px 0 0 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.rel-mention-snippet {
	opacity: 0.85;
	font-size: 12.5px;
	line-height: 1.35;
}

.rel-mention-card:hover {
	background: var(--background-modifier-hover);
}
`
}
