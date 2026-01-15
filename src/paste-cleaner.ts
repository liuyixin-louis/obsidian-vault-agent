import { MarkdownView, type Editor, htmlToMarkdown } from "obsidian"
import type { TerminalPlugin } from "./main.js"

function looksLikeMarkdownTable(text: string): boolean {
	const lines = text.split("\n").map(line => line.trim())
	if (lines.length < 2) { return false }
	const pipeLines = lines.filter(line => line.includes("|"))
	if (pipeLines.length < 2) { return false }
	const separatorRegex =
		/^\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/
	return lines.some(line => separatorRegex.test(line))
}

function normalizeMarkdownTable(text: string): string {
	const lines = text.split("\n")
	const out: string[] = []
	let inTable = false
	let lastRowIndex = -1

	const separatorRegex =
		/^\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		const trimmed = line.trim()
		const isPipeRow = /^\s*\|/.test(trimmed)
		const isSeparator = separatorRegex.test(trimmed)
		const startsWithBr = /^<br\s*\/?>/i.test(trimmed)

		if (inTable) {
			if (isPipeRow || isSeparator) {
				out.push(trimmed)
				lastRowIndex = out.length - 1
				continue
			}
			if (trimmed === "") {
				// drop spacer lines inside table
				continue
			}
			if (startsWithBr && lastRowIndex >= 0) {
				out[lastRowIndex] = `${out[lastRowIndex]}<br>${trimmed.replace(
					/^<br\s*\/?>/i,
					"<br>",
				)}`
				continue
			}
			// continuation lines inside a cell
			if (isTableTerminatorLine(trimmed)) {
				inTable = false
				// fall through to handle as normal content
			} else if (lastRowIndex >= 0) {
				out[lastRowIndex] = `${out[lastRowIndex]}<br>${trimmed}`
				continue
			} else {
				inTable = false
			}
		}

		if (isPipeRow || isSeparator) {
			inTable = true
			out.push(trimmed)
			lastRowIndex = out.length - 1
			continue
		}

		out.push(line)
	}

	return out.join("\n")
}

function isTableTerminatorLine(t: string): boolean {
	const s = t.trim()
	if (!s) { return false }
	if (/^#{1,6}\s/.test(s)) { return true }
	if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) { return true }
	return false
}

function normalizeText(text: string): string {
	const base = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
	if (looksLikeMarkdownTable(base)) {
		// Tables: keep structure but drop blank spacer lines and invisible chars
		const cleanedTable = base
			.replace(/\u00A0/g, " ")
			.replace(/[\u200B-\u200D\uFEFF]/g, "")
			.replace(/\n[ \t]*\n+/g, "\n")
		return normalizeMarkdownTable(cleanedTable)
	}
	return base
		.replace(/\u00A0/g, " ")
		.replace(/[\u200B-\u200D\uFEFF]/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\n+$/g, "\n")
}

function looksLikePython(text: string): boolean {
	const t = text.trim()
	if (!t) { return false }

	if (/^```/.test(t) || t.includes("\n```")) { return false }
	if (looksLikeMarkdownTable(t)) { return false }

	const lines = t.split("\n"),
		longEnough = lines.length >= 2 || t.length >= 60

	let score = 0
	let strongHits = 0

	const strong = [
		/\bdef\s+\w+\s*\(/,
		/\bclass\s+\w+/,
		/^\s*(from|import)\s+[\w.]+/m,
		/^\s*if\s+.+:\s*$/m,
		/^\s*(for|while|try|except|with|elif|else)\b.*:\s*$/m,
		/\basync\s+def\b/,
		/\bawait\b/,
	]
	for (const regex of strong) {
		if (regex.test(t)) {
			score += 3
			strongHits += 1
		}
	}

	if (/^\s{4,}\S/m.test(t) || /^\t+\S/m.test(t)) { score += 2 }
	if (/#+.*$/m.test(t)) { score += 2 } // comment-heavy content
	if (/("""|''')/m.test(t)) { score += 2 } // docstring markers
	if (/print\(/.test(t)) { score += 1 }
	if (/=\s*[\w"'[{(]/.test(t)) { score += 1 }
	if (/\bfrom\s+typing\s+import\b|\bList\[[^\]]*\]/.test(t)) { score += 2 }
	if (/\bheappush\b|\bheappop\b|\bheapq\b/.test(t)) { score += 1 }
	if ((t.match(/\bdef\s+\w+\s*\(/g) ?? []).length >= 2) { score += 1 }
	if (/\breturn\s+\w+/.test(t)) { score += 1 }

	if (/^\s*[{[]/.test(t) && /"\w+"\s*:/.test(t)) { score -= 3 }
	if (/^\s*[-\w]+:\s+\S/m.test(t) && !/\bdef\b|\bclass\b/.test(t)) {
		score -= 2
	}
	if (/^\s*(sudo|apt|brew|pip|conda|cd|ls|cat)\b/m.test(t)) { score -= 2 }
	// Defensive: if we never hit a strong Python-only pattern, don't classify as Python.
	if (strongHits < 2) { return false }

	const threshold = longEnough ? 3 : 4
	return score >= threshold
}

function isCursorInsideCodeFence(editor: Editor): boolean {
	const cursor = editor.getCursor()
	let fenceCount = 0
	for (let lineIndex = 0; lineIndex <= cursor.line; lineIndex++) {
		const line = editor.getLine(lineIndex)
		if (/^\s*```/.test(line)) { fenceCount += 1 }
	}
	return fenceCount % 2 === 1
}

function wrapAsPythonFence(text: string): string {
	const body = text.replace(/\n+$/g, "")
	return `\`\`\`python\n${body}\n\`\`\`\n`
}

export function loadPasteCleaner(plugin: TerminalPlugin): void {
	plugin.registerDomEvent(document, "paste", (evt: ClipboardEvent) => {
		const evtAny = evt as unknown as { _terminalHandled?: boolean }
		if (evtAny._terminalHandled) { return }
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView),
			editor = view?.editor,
			plain = evt.clipboardData?.getData("text/plain"),
			html = evt.clipboardData?.getData("text/html") ?? ""

		if (!editor || plain === null || plain === undefined) { return }

		evtAny._terminalHandled = true
		const activeEl = document.activeElement as HTMLElement | null,
			isEditorFocused = Boolean(
				activeEl?.classList?.contains("cm-content") ||
					activeEl?.closest?.(".markdown-source-view") ||
					activeEl?.closest?.(".cm-editor"),
			)
		if (!isEditorFocused) { return }

		// Stop default paste (and other paste handlers) to avoid double insertion.
		evt.preventDefault()
		evt.stopPropagation()
		evt.stopImmediatePropagation()

		let source = plain
		if (html && html.trim()) {
			try {
				source = htmlToMarkdown(html)
			} catch {
				source = plain
			}
		}

		const pipeLines = source.split("\n").filter(line => line.includes("|")).length
		const hasPipeTable = pipeLines >= 2 && /[-:]\|/.test(source)

		const hasTable =
			/<table[\s>]/i.test(html) ||
			looksLikeMarkdownTable(source) ||
			looksLikeMarkdownTable(plain) ||
			hasPipeTable

		// Use Obsidian's native conversion; skip extra repair to keep tables editable.
		const cleaned = normalizeText(source)

		const content = !isCursorInsideCodeFence(editor) && looksLikePython(cleaned)
			&& !hasTable
			? wrapAsPythonFence(cleaned)
			: cleaned
		editor.replaceSelection(content)
	}, { capture: true })
}
