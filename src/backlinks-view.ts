import { ItemView, TFile, WorkspaceLeaf } from "obsidian"
import type { TerminalPlugin } from "./main.js"
import {
	getBacklinksStyles,
	renderBacklinksWithPreviews,
} from "./backlinks.js"

export const BACKLINKS_VIEW_TYPE = "terminal-ai-backlinks"

interface ObsidianEl extends HTMLElement {
	addClass(cls: string): void
	createDiv(options?: { cls?: string; text?: string }): ObsidianEl
	createEl<K extends keyof HTMLElementTagNameMap>(
		tag: K,
		options?: { cls?: string; text?: string },
	): HTMLElementTagNameMap[K] & ObsidianEl
	empty(): void
}

class BacklinksView extends ItemView {
	private readonly plugin: TerminalPlugin
	private currentFile: TFile | null = null

	public constructor(leaf: WorkspaceLeaf, plugin: TerminalPlugin) {
		super(leaf)
		this.plugin = plugin
	}

	public override getViewType(): string {
		return BACKLINKS_VIEW_TYPE
	}

	public override getDisplayText(): string {
		return "Linked Mentions"
	}

	public override getIcon(): string {
		return "links-coming-in"
	}

	public override async onOpen(): Promise<void> {
		const el = this.contentEl as ObsidianEl
		el.empty()
		el.addClass("backlinks-view-container")

		const activeFile = this.plugin.app.workspace.getActiveFile()
		if (activeFile) {
			await this.renderForFile(activeFile)
		} else {
			el.createDiv({
				cls: "backlinks-empty",
				text: "Open a file to see linked mentions",
			})
		}
	}

	public async renderForFile(file: TFile): Promise<void> {
		if (this.currentFile?.path === file.path) {
			return
		}
		this.currentFile = file

		const el = this.contentEl as ObsidianEl
		el.empty()

		const header = el.createDiv({ cls: "backlinks-header" })
		header.createEl("h4", {
			cls: "backlinks-title",
			text: `Mentions of "${file.basename}"`,
		})

		const listContainer = el.createDiv({ cls: "backlinks-list" })

		await renderBacklinksWithPreviews(
			this.plugin.app,
			listContainer,
			file,
			{ sortMode: "recent", maxSnippetsPerFile: 3 },
		)
	}

	public override async onClose(): Promise<void> {
		this.currentFile = null
	}
}

function injectStyles(plugin: TerminalPlugin): void {
	const styleId = "terminal-ai-backlinks-styles"
	const doc = plugin.app.workspace.containerEl.ownerDocument

	if (doc.getElementById(styleId)) {
		return
	}

	const styleEl = doc.createElement("style")
	styleEl.id = styleId
	styleEl.textContent = `
${getBacklinksStyles()}

.backlinks-view-container {
	padding: 12px;
	overflow-y: auto;
}

.backlinks-header {
	margin-bottom: 12px;
}

.backlinks-title {
	margin: 0;
	font-size: 14px;
	font-weight: 600;
	opacity: 0.9;
}

.backlinks-empty {
	opacity: 0.6;
	font-size: 13px;
	text-align: center;
	padding: 20px;
}

.backlinks-list {
	/* container for rel-mentions-list */
}
`
	doc.head.appendChild(styleEl)

	plugin.register(() => {
		styleEl.remove()
	})
}

async function activateView(plugin: TerminalPlugin): Promise<BacklinksView | null> {
	const { workspace } = plugin.app

	let leaf = workspace.getLeavesOfType(BACKLINKS_VIEW_TYPE)[0]

	if (!leaf) {
		const rightLeaf = workspace.getRightLeaf(false)
		if (!rightLeaf) {
			return null
		}
		leaf = rightLeaf
		await leaf.setViewState({
			type: BACKLINKS_VIEW_TYPE,
			active: true,
		})
	}

	const view = leaf.view
	if (view instanceof BacklinksView) {
		return view
	}
	return null
}

export function loadBacklinks(plugin: TerminalPlugin): void {
	injectStyles(plugin)

	plugin.registerView(
		BACKLINKS_VIEW_TYPE,
		(leaf) => new BacklinksView(leaf, plugin),
	)

	plugin.registerEvent(
		plugin.app.workspace.on("file-open", async (file) => {
			if (!file) {
				return
			}

			const leaves = plugin.app.workspace.getLeavesOfType(BACKLINKS_VIEW_TYPE)
			for (const leaf of leaves) {
				const view = leaf.view
				if (view instanceof BacklinksView) {
					await view.renderForFile(file)
				}
			}
		}),
	)

	plugin.addCommand({
		id: "open-backlinks-view",
		name: "Open linked mentions panel",
		callback: async () => {
			await activateView(plugin)
		},
	})

	plugin.app.workspace.onLayoutReady(async () => {
		const activeFile = plugin.app.workspace.getActiveFile()
		if (activeFile) {
			const leaves = plugin.app.workspace.getLeavesOfType(BACKLINKS_VIEW_TYPE)
			for (const leaf of leaves) {
				const view = leaf.view
				if (view instanceof BacklinksView) {
					await view.renderForFile(activeFile)
				}
			}
		}
	})
}
