/**
 * pi-minimal-ask - A single `ask` tool with a minimal TUI form.
 *
 * The LLM asks one or more short `single` / `multiple` choice questions and
 * blocks until the user submits. The user can also type a free-form answer
 * via a subtle bottom row (no explicit "other" field).
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Kind = "single" | "multiple";

export interface AskInput {
	kind: Kind;
	question: string;
	answers: string[];
}

export interface QA {
	question: string;
	kind: Kind;
	answers: string[];
	selected: string[];
	custom?: string;
}

interface FormResult {
	answers: QA[];
	cancelled: boolean;
}

type Row =
	| { type: "answer"; i: number }
	| { type: "freeform" }
	| { type: "submit" };

const AskParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			kind: StringEnum(["single", "multiple"] as const),
			question: Type.String({ description: "The question text to ask" }),
			answers: Type.Array(Type.String({ description: "Answer choices" })),
		}),
	),
});

function normQ(q: string): string {
	const t = q.trim();
	return /[?.!]$/.test(t) ? t : t + "?";
}

export function formatAnswer(a: QA): string {
	const q = `Q: ${normQ(a.question)} A: `;
	if (a.kind === "single") {
		const hit = a.custom?.trim() ? a.custom : a.selected[0];
		return q + (hit || "<no response>");
	}
	const parts: string[] = [];
	for (const s of a.selected) parts.push(`"${s}"`);
	if (a.custom && a.custom.trim()) parts.push(`"${a.custom}"`);
	return q + (parts.length ? parts.join(", ") : "<no response>");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description:
			"Ask the user one or more short questions and collect their answers. Use when you need a decision, preference, or confirmation before continuing.",
		promptSnippet: "Ask the user a short single or multiple-choice question and wait",
		promptGuidelines: [
			"Use the ask tool when you need the user to make a choice or confirm something before continuing.",
			"Use kind single for one choice (radio) and kind multiple when the user may pick several answers.",
			"Put the most recommended choice first in answers; it is shown to the user as the first answer.",
			"The user can also type a free-form answer, so do not add an 'other' or similar choice in answers.",
		],
		parameters: AskParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { answers: [], cancelled: true } as FormResult,
				};
			}
			const questions: AskInput[] = params.questions;
			if (questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No questions provided" }],
					details: { answers: [], cancelled: true } as FormResult,
				};
			}

			const result = await ctx.ui.custom<FormResult>((tui, theme, _kb, done) => {
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

				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

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
						} as QA;
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
					editor.setText("");
					refresh();
				}

				editor.onSubmit = (value) => {
					const trimmed = value.trim();
					if (!trimmed) {
						inputMode = false;
						editor.setText("");
						refresh();
						return;
					}
					customTxt[current] = trimmed;
					inputMode = false;
					editor.setText("");
					if (questions[current].kind === "single") {
						advance();
					} else {
						refresh();
					}
				};

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
						if (matchesKey(data, Key.escape)) {
							inputMode = false;
							editor.setText("");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
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

					const check = (t: Tab) => (t.answered ? "󰄱 " : " ");
					let total = tabs.reduce((s, t) => s + visibleWidth(`${check(t)}${t.label} `), 0);
					let overflow = total - rw;
					if (overflow > 0) {
						const nonActive = tabs
							.filter((t) => !t.active)
							.sort((a, b) => visibleWidth(b.label) - visibleWidth(a.label));
						for (const t of nonActive) {
							if (overflow <= 0) break;
							const w = visibleWidth(t.label);
							const cut = Math.max(1, Math.min(w, overflow));
							t.label = truncateToWidth(t.label, Math.max(0, w - cut), "");
							overflow -= cut;
						}
					}
					return tabs
						.map((t) => {
							const text = `${check(t)}${t.label} `;
							return t.active
								? theme.bg("selectedBg", theme.fg("text", text))
								: theme.fg(t.answered ? "success" : "muted", text);
						})
						.join("");
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
						lines.push("");
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
						addPrefix(" ", theme.fg("accent", theme.bold("Confirm?")));
						lines.push("");
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

					addPrefix(" ", theme.fg("accent", theme.bold(q.question)));
					lines.push("");

					for (let i = 0; i < opts.length; i++) {
						const row = opts[i];
						const prefix = i === optionIndex ? theme.fg("accent", "> ") : "  ";
						if (row.type === "answer") {
							if (q.kind === "single") {
								const isSel = singleSel[current] === row.i;
								const color = isSel ? "accent" : i === optionIndex ? "accent" : "text";
								const mark = isSel ? theme.fg("success", "󰄱 ") : "   ";
								addPrefix(prefix, theme.fg(color, `${row.i + 1}. ${mark}${q.answers[row.i]}`));
							} else {
								const checked = multiSel[current].has(row.i);
								const glyph = checked ? theme.fg("success", "󰄱") : theme.fg("muted", "󰱒");
								addPrefix(prefix, theme.fg(i === optionIndex ? "accent" : "text", `${glyph} ${row.i + 1}. ${q.answers[row.i]}`));
							}
						} else if (row.type === "freeform") {
							addPrefix(prefix, theme.fg("dim", "Type something"));
						} else {
							addPrefix(prefix, theme.fg(i === optionIndex ? "accent" : "muted", "󰄱 Submit"));
						}
					}

					if (inputMode) {
						lines.push("");
						addPrefix(" ", theme.fg("muted", "Your answer:"));
						for (const line of editor.render(Math.max(1, rw - 2))) {
							lines.push(` ${line}`);
						}
						lines.push("");
						addPrefix(" ", theme.fg("dim", "Enter to submit • Esc to cancel"));
					} else {
						lines.push("");
						const help = isMultiQ
							? "←→ / h l question • ↑↓ / j k move • Enter select • Esc abort"
							: q.kind === "multiple"
								? "↑↓ / j k move • Enter toggle • 󰄱 Submit to finish • Esc abort"
								: "↑↓ / j k move • Enter select • Esc abort";
						addPrefix(" ", theme.fg("dim", help));
					}

					lines.push(theme.fg("accent", "─".repeat(rw)));
					cachedLines = lines;
					return lines;
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

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			const lines = result.answers.map((a) => (result.cancelled ? `Q: ${a.question} A: <no response>` : formatAnswer(a)));
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme, _context) {
			const qs = (args.questions as AskInput[]) || [];
			if (qs.length === 0) {
				return new Text(theme.fg("toolTitle", "ask"), 0, 0);
			}
			const first = qs[0];
			let text =
				theme.fg("toolTitle", "ask ") +
				theme.fg("text", first.question) +
				" " +
				theme.fg("dim", `(${first.kind})`);
			if (qs.length > 1) {
				text += theme.fg("dim", ` +${qs.length - 1}`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const d = result.details as FormResult | undefined;
			if (!d) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (d.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			if (!expanded) {
				const summary = d.answers.map((a) => a.selected.join(", ") || a.custom || "<no response>").join(" | ");
				return new Text(theme.fg("success", "✓ ") + theme.fg("muted", summary), 0, 0);
			}
			return new Text(d.answers.map(formatAnswer).join("\n"), 0, 0);
		},
	});
}
