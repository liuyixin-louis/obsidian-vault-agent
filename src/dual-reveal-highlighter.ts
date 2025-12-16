const
	CSS_ITEM = "dual-reveal-item",
	CSS_STRIPE_A = "dual-reveal-a",
	CSS_STRIPE_B = "dual-reveal-b"

export interface NavigatorSpec {
	readonly name: string
	readonly root: HTMLElement
	readonly findItemElByPath: (
		root: HTMLElement,
		path: string,
	) => HTMLElement | null
}

export interface HighlightState {
	pathA?: string | undefined
	pathB?: string | undefined
}

export class DualRevealHighlighter {
	readonly #specs: NavigatorSpec[] = []
	#state: HighlightState = {}
	readonly #observers: MutationObserver[] = []
	#clearTimeoutId: number | null = null

	public registerNavigator(spec: NavigatorSpec): () => void {
		this.#specs.push(spec)

		const mo = new MutationObserver(() => { this.#applyAll() })
		mo.observe(spec.root, { childList: true, subtree: true })
		this.#observers.push(mo)

		this.#applyAll()

		return (): void => {
			const idx = this.#specs.indexOf(spec)
			if (idx !== -1) {
				this.#specs.splice(idx, 1)
			}
			mo.disconnect()
			const moIdx = this.#observers.indexOf(mo)
			if (moIdx !== -1) {
				this.#observers.splice(moIdx, 1)
			}
		}
	}

	public setTargets(
		pathA?: string,
		pathB?: string,
		autoClearMs?: number,
	): void {
		if (this.#clearTimeoutId !== null) {
			self.clearTimeout(this.#clearTimeoutId)
			this.#clearTimeoutId = null
		}

		this.#state = { pathA, pathB }
		this.#applyAll()

		if (typeof autoClearMs === "number" && autoClearMs > 0) {
			this.#clearTimeoutId = self.setTimeout(() => {
				this.clear()
				this.#clearTimeoutId = null
			}, autoClearMs)
		}
	}

	public clear(): void {
		if (this.#clearTimeoutId !== null) {
			self.clearTimeout(this.#clearTimeoutId)
			this.#clearTimeoutId = null
		}
		this.#state = {}
		this.#applyAll()
	}

	public destroy(): void {
		if (this.#clearTimeoutId !== null) {
			self.clearTimeout(this.#clearTimeoutId)
			this.#clearTimeoutId = null
		}
		for (const observer of this.#observers) {
			observer.disconnect()
		}
		this.#observers.length = 0
		for (const spec of this.#specs) {
			clearInRoot(spec.root)
		}
		this.#specs.length = 0
		this.#state = {}
	}

	#applyAll(): void {
		for (const spec of this.#specs) {
			clearInRoot(spec.root)

			const { pathA, pathB } = this.#state
			if (typeof pathA === "string" && pathA !== "") {
				applyOne(spec, pathA, "A")
			}
			if (typeof pathB === "string" && pathB !== "") {
				applyOne(spec, pathB, "B")
			}
		}
	}
}

function clearInRoot(root: HTMLElement): void {
	const elements = Array.from(root.querySelectorAll(`.${CSS_ITEM}`))
	for (const el of elements) {
		el.classList.remove(CSS_ITEM, CSS_STRIPE_A, CSS_STRIPE_B)
	}
}

function applyOne(
	spec: NavigatorSpec,
	path: string,
	which: "A" | "B",
): void {
	const el = spec.findItemElByPath(spec.root, path)
	if (!el) { return }

	el.classList.add(CSS_ITEM)
	el.classList.add(which === "A" ? CSS_STRIPE_A : CSS_STRIPE_B)
}

function escapeForSelector(path: string): string {
	return CSS.escape(path)
}

export function findInFileExplorer(
	root: HTMLElement,
	path: string,
): HTMLElement | null {
	const escaped = escapeForSelector(path)

	let el = root.querySelector<HTMLElement>(
		`.nav-file-title[data-path="${escaped}"]`,
	)
	if (el) { return el }

	el = root.querySelector<HTMLElement>(
		`.nav-file[data-path="${escaped}"] .nav-file-title`,
	)
	if (el) { return el }

	el = root.querySelector<HTMLElement>(
		`.nav-folder-title[data-path="${escaped}"]`,
	)
	if (el) { return el }

	el = root.querySelector<HTMLElement>(
		`.nav-folder[data-path="${escaped}"] .nav-folder-title`,
	)
	if (el) { return el }

	return null
}

export function findByDataPath(
	root: HTMLElement,
	path: string,
): HTMLElement | null {
	const escaped = escapeForSelector(path)
	return root.querySelector<HTMLElement>(`[data-path="${escaped}"]`)
}

interface WorkspaceWithLeaves {
	getLeavesOfType: (
		type: string,
	) => { view?: { containerEl?: HTMLElement } }[]
}

export function getFileExplorerRoot(
	workspace: WorkspaceWithLeaves,
): HTMLElement | null {
	const [leaf] = workspace.getLeavesOfType("file-explorer"),
		view = leaf?.view as { containerEl?: HTMLElement } | undefined
	return view?.containerEl ?? null
}
