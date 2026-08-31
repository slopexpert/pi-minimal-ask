// TUI form controller: renders the interactive question form and handles input
import type { TUI } from "@earendil-works/pi-tui";
import {
	decodeKittyPrintable,
	Key,
	matchesKey,
	stripTerminalSequences,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AskInput, FormResult, Row } from "./types.js";

export interface FormComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

export function createForm(
	questions: AskInput[],
	tui: TUI,
	theme: Theme,
	done: (result: FormResult) => void,
): FormComponent {
	const n = questions.length;
	const isMultiQ = n > 1;

	// Form state
	let current = 0; // 0..n-1 questions, n = Confirm page
	let optionIndex = 0;
	const singleSel = questions.map(() => -1);
	const multiSel = questions.map(() => new Set<number>());
	const customTxt = questions.map(() => undefined as string | undefined);
	let inputMode = false;
	let abortConfirm = false;
	let cachedLines: string[] | undefined;
	let editText = "";
	let editPos = 0;

	function refresh() {
		cachedLines = undefined;
		tui.requestRender();
	}

	function isAnswered(qi: number): boolean {
		if (customTxt[qi]) return true;
		if (questions[qi].kind === "multiple") return multiSel[qi].size > 0;
		return singleSel[qi] >= 0;
	}

	function allAnswered(): boolean {
		return questions.every((_, i) => isAnswered(i));
	}

	function optionsFor(qi: number): Row[] {
		const q = questions[qi];
		const rows: Row[] = q.answers.map((_, i) => ({ type: "answer", i }));
		rows.push({ type: "freeform" });
		if (q.kind === "multiple" && n === 1) rows.push({ type: "submit" });
		return rows;
	}

	function saveQAs(cancelled: boolean): FormResult {
		const answers = questions.map((q, i) => {
			const selected =
				q.kind === "single"
					? singleSel[i] >= 0
						? [q.answers[singleSel[i]]]
						: []
					: [...multiSel[i]]
							.sort((a, b) => a - b)
							.map((idx) => q.answers[idx]);
			return {
				question: q.question,
				kind: q.kind,
				answers: q.answers,
				selected: cancelled ? [] : selected,
				custom: customTxt[i],
			};
		});
		return { answers, cancelled };
	}

	function advance() {
		if (n === 1) {
			done(saveQAs(false));
			return;
		}
		if (current < n - 1) {
			current++;
		} else {
			current = n; // Confirm page
		}
		optionIndex = 0;
		refresh();
	}

	function goPrev() {
		if (current > 0) {
			current--;
			optionIndex = 0;
			refresh();
		}
	}

	function goNext() {
		if (current < n) {
			current++;
			optionIndex = 0;
			refresh();
		}
	}

	function openEditor() {
		inputMode = true;
		editText = customTxt[current] || "";
		editPos = editText.length;
		refresh();
	}

	function commitFreeform() {
		const trimmed = editText.trim();
		if (!trimmed) {
			customTxt[current] = undefined;
			inputMode = false;
			refresh();
			return;
		}
		customTxt[current] = trimmed;
		inputMode = false;
		if (questions[current].kind === "single") {
			advance();
		} else {
			refresh();
		}
	}

	function insertAt(pos: number, ch: string): string {
		const chars = Array.from(editText);
		chars.splice(pos, 0, ch);
		return chars.join("");
	}

	function deleteAt(pos: number): string {
		const chars = Array.from(editText);
		if (pos < chars.length) chars.splice(pos, 1);
		return chars.join("");
	}

	function handleFreeformInput(data: string) {
		if (matchesKey(data, Key.enter)) {
			commitFreeform();
			return;
		}
		if (matchesKey(data, Key.escape)) {
			customTxt[current] = undefined;
			inputMode = false;
			refresh();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (editPos > 0) {
				editText = deleteAt(editPos - 1);
				editPos--;
			}
			refresh();
			return;
		}
		if (matchesKey(data, Key.delete)) {
			editText = deleteAt(editPos);
			refresh();
			return;
		}
		if (matchesKey(data, Key.left)) {
			editPos = Math.max(0, editPos - 1);
			refresh();
			return;
		}
		if (matchesKey(data, Key.right)) {
			editPos = Math.min(Array.from(editText).length, editPos + 1);
			refresh();
			return;
		}
		if (matchesKey(data, Key.home)) {
			editPos = 0;
			refresh();
			return;
		}
		if (matchesKey(data, Key.end)) {
			editPos = Array.from(editText).length;
			refresh();
			return;
		}
		let printable = decodeKittyPrintable(data);
		if (printable === undefined && data.length === 1) {
			const code = data.charCodeAt(0);
			if (code >= 32 && code !== 127) printable = data;
		}
		if (printable !== undefined) {
			editText = insertAt(editPos, printable);
			editPos++;
			refresh();
		}
	}

	function handleEnter(opts: Row[]) {
		if (current === n) {
			done(saveQAs(false));
			return;
		}
		const row = opts[optionIndex];
		if (!row) return;
		if (row.type === "answer") {
			const q = questions[current];
			if (q.kind === "single") {
				singleSel[current] = row.i;
				customTxt[current] = undefined;
				advance();
			} else {
				const set = multiSel[current];
				if (set.has(row.i)) set.delete(row.i);
				else set.add(row.i);
				refresh();
			}
			return;
		}
		if (row.type === "freeform") {
			openEditor();
			return;
		}
		// submit row (single-question multiple form)
		done(saveQAs(false));
	}

	function handleEscape() {
		if (n <= 1) {
			done(saveQAs(true));
			return;
		}
		abortConfirm = true;
		refresh();
	}

	function handleInput(data: string) {
		if (abortConfirm) {
			if (matchesKey(data, Key.escape)) {
				done(saveQAs(true));
			} else if (matchesKey(data, Key.enter)) {
				abortConfirm = false;
				refresh();
			}
			return;
		}
		if (inputMode) {
			handleFreeformInput(data);
			return;
		}

		if (current < n) {
			const opts = optionsFor(current);
			if (matchesKey(data, Key.left) || data === "h") {
				goPrev();
				return;
			}
			if (matchesKey(data, Key.right) || data === "l") {
				goNext();
				return;
			}
			if (matchesKey(data, Key.up) || data === "k") {
				optionIndex = Math.max(0, optionIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down) || data === "j") {
				optionIndex = Math.min(opts.length - 1, optionIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				handleEnter(opts);
				return;
			}
		} else {
			// Confirm page
			if (matchesKey(data, Key.left) || data === "h") {
				goPrev();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				handleEnter([]);
				return;
			}
		}
		if (matchesKey(data, Key.escape)) {
			handleEscape();
			return;
		}
	}

	function buildTabLine(rw: number): string {
		type Tab = { label: string; active: boolean; answered: boolean };
		const tabs: Tab[] = questions.map((q, i) => ({
			label: q.question,
			active: i === current,
			answered: isAnswered(i),
		}));
		tabs.push({ label: "Confirm?", active: current === n, answered: false });

		// fixed per-tab budget so every label gets the same width, no starved tabs
		const target = Math.max(1, rw - 1);
		const maxLabel = Math.max(1, Math.floor(target / tabs.length) - 4);
		for (const t of tabs) {
			if (visibleWidth(t.label) > maxLabel) {
				t.label = stripTerminalSequences(
					truncateToWidth(t.label, maxLabel, "…"),
				);
			}
		}
		return tabs
			.map((t) => {
				// symmetric 1-space padding on both sides of the box
				const text = ` ${t.label} `;
				return t.active
					? theme.bg("selectedBg", theme.fg("text", text))
					: theme.fg(t.answered ? "success" : "muted", text);
			})
			.join("");
	}

	function cursorText(text: string): string {
		const chars = Array.from(text);
		const before = chars.slice(0, editPos).join("");
		const at = chars[editPos];
		if (at === undefined) {
			return before + "\x1b[7m \x1b[0m";
		}
		return before + "\x1b[7m" + at + "\x1b[0m" + chars.slice(editPos + 1).join("");
	}

	function shortAnswer(qi: number): string {
		const q = questions[qi];
		if (q.kind === "single") {
			return singleSel[qi] >= 0 ? q.answers[singleSel[qi]] : customTxt[qi] || "<none>";
		}
		const vals = [...multiSel[qi]].sort((a, b) => a - b).map((i) => q.answers[i]);
		if (customTxt[qi]) vals.push(customTxt[qi]);
		return vals.length ? vals.join(", ") : "<none>";
	}

	function render(width: number): string[] {
		if (cachedLines) return cachedLines;

		const lines: string[] = [];
		const rw = Math.max(1, width);

		function addWrapped(text: string) {
			lines.push(...wrapTextWithAnsi(text, rw));
		}

		function addPrefix(prefix: string, text: string) {
			const pw = visibleWidth(prefix);
			if (pw >= rw) {
				addWrapped(prefix + text);
				return;
			}
			const wrapped = wrapTextWithAnsi(text, rw - pw);
			const cont = " ".repeat(pw);
			for (let i = 0; i < wrapped.length; i++) {
				lines.push(`${i === 0 ? prefix : cont}${wrapped[i]}`);
			}
		}

		lines.push(theme.fg("accent", "─".repeat(rw)));

		if (isMultiQ) {
			addPrefix(" ", buildTabLine(rw));
		}

		if (abortConfirm) {
			addPrefix(" ", theme.fg("warning", theme.bold("Abort?")));
			lines.push("");
			addPrefix(" ", theme.fg("dim", "Esc to confirm abort • Enter to go back"));
			lines.push(theme.fg("accent", "─".repeat(rw)));
			cachedLines = lines;
			return lines;
		}

		if (current === n) {
			for (let i = 0; i < n; i++) {
				addPrefix(" ", theme.fg("muted", `Question ${i + 1}: `) + theme.fg("text", shortAnswer(i)));
			}
			lines.push("");
			if (allAnswered()) {
				addPrefix(" ", theme.fg("dim", "Enter to submit • ←/h to go back • Esc abort"));
			} else {
				addPrefix(" ", theme.fg("warning", "Answer every question to submit"));
			}
			lines.push(theme.fg("accent", "─".repeat(rw)));
			cachedLines = lines;
			return lines;
		}

		const q = questions[current];
		const opts = optionsFor(current);

		if (isMultiQ) {
			// full active question below the compact tab bar
			lines.push("");
			addWrapped(theme.fg("accent", theme.bold(q.question)));
			lines.push("");
		} else {
			addPrefix(" ", theme.fg("accent", theme.bold(q.question)));
		}

		for (let i = 0; i < opts.length; i++) {
			const row = opts[i];
			const prefix = i === optionIndex ? theme.fg("accent", "> ") : "  ";
			if (row.type === "answer") {
				if (q.kind === "single") {
					const isSel = singleSel[current] === row.i;
					const color = isSel ? "accent" : i === optionIndex ? "accent" : "text";
					addPrefix(prefix, theme.fg(color, `${row.i + 1}. ${q.answers[row.i]}`));
				} else {
					const checked = multiSel[current].has(row.i);
					const glyph = checked ? theme.fg("success", "󰱒") : theme.fg("muted", "󰄱");
					addPrefix(prefix, theme.fg(i === optionIndex ? "accent" : "text", `${glyph} ${q.answers[row.i]}`));
				}
			} else if (row.type === "freeform") {
				if (inputMode) {
					addPrefix(prefix, theme.fg("accent", cursorText(editText)));
				} else {
					const cur = customTxt[current];
					addPrefix(prefix, cur ? theme.fg("text", cur) : theme.fg("dim", "Type something"));
				}
			} else {
				addPrefix(prefix, theme.fg(i === optionIndex ? "accent" : "muted", "✓ Submit"));
			}
		}

		if (inputMode) {
			addPrefix(" ", theme.fg("dim", "Enter to submit • Esc to cancel"));
		} else {
			const help = isMultiQ
				? "←→/hl question • ↑↓/jk move • Enter select • Esc abort"
				: q.kind === "multiple"
					? "↑↓/jk move • Enter toggle • ✓ Submit to finish • Esc abort"
					: "↑↓/jk move • Enter select • Esc abort";
			addPrefix(" ", theme.fg("dim", help));
		}

		lines.push(theme.fg("accent", "─".repeat(rw)));
		cachedLines = lines;
		return lines;
	}

	return {
		render,
		invalidate: () => {
			cachedLines = undefined;
		},
		handleInput,
	};
}
