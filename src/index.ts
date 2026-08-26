/**
 * pi-minimal-ask - A single `ask` tool with a minimal TUI form.
 *
 * The LLM asks one or more short `single` / `multiple` choice questions and
 * blocks until the user submits. The user can also type a free-form answer
 * via a subtle bottom row (no explicit "other" field).
 */

import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatAnswer } from "./format.js";
import { createForm } from "./form.js";
import {
  AskParams,
  ASK_PROMPT_EVENT,
  type AskInput,
  type FormResult,
  sanitizeAnswers,
} from "./types.js";

export { formatAnswer } from "./format.js";
export { sanitizeAnswers } from "./types.js";
export type { AskInput, QA, FormResult, Kind, Row } from "./types.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask",
    label: "Ask",
    description:
      "Ask the user one or more short questions and collect their answers. Use when you need a decision, preference, or confirmation before continuing.",
    promptSnippet:
      "Ask the user a short single or multiple-choice question and wait",
    promptGuidelines: [
      "Use the ask tool when you need the user to make a choice or confirm something before continuing.",
      "Use kind single for one choice (radio) and kind multiple when the user may pick several answers; in that case, do not say 'select all that apply' or similar in the question text.",
      "Put the most recommended choice first in answers; it is shown to the user as the first answer.",
      "The user can also type a free-form answer, so NEVER add an 'other', 'something else' or similar choice in answers.",
    ],
    parameters: AskParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        return {
          content: [
            {
              type: "text",
              text: "Error: UI not available (running in non-interactive mode)",
            },
          ],
          details: { answers: [], cancelled: true } as FormResult,
        };
      }
      const questions: AskInput[] = params.questions.map((q) => ({
        ...q,
        answers: sanitizeAnswers(q.answers),
      }));
      if (questions.length === 0) {
        return {
          content: [{ type: "text", text: "Error: No questions provided" }],
          details: { answers: [], cancelled: true } as FormResult,
        };
      }

      // Notify listeners (e.g. desktop notifications) that we're waiting on the user
      pi.events.emit(ASK_PROMPT_EVENT, {
        questions: questions.map((q) => ({ question: q.question })),
      });

      const result = await ctx.ui.custom<FormResult>((tui, theme, _kb, done) =>
        createForm(questions, tui, theme, done),
      );

      const lines = result.answers.map((a) =>
        result.cancelled
          ? `Q: ${a.question} A: <no response>`
          : formatAnswer(a),
      );
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
        const summary = d.answers
          .map((a) => a.selected.join(", ") || a.custom || "<no response>")
          .join(" | ");
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("muted", summary),
          0,
          0,
        );
      }
      return new Text(d.answers.map(formatAnswer).join("\n"), 0, 0);
    },
  });
}
