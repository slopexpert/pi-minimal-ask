import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export type Kind = "single" | "multiple";

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

export interface FormResult {
	answers: QA[];
	cancelled: boolean;
}

export type Row =
	| { type: "answer"; i: number }
	| { type: "freeform" }
	| { type: "submit" };

// Event emitted on the shared extension bus when a question is asked,
// so notification extensions can alert the user (see agent-done-notify)
export const ASK_PROMPT_EVENT = "minimal-ask:prompt";

// Answers that must never be shown to the user, whatever the agent asks for
const ANSWER_BLACKLIST = new Set([
	"other",
	"other (i'll describe it)",
	"something else",
	"something else (i'll describe it)",
	"none of the above",
	"none of the above (i'll describe it)",
	// describe-it / escape-hatch variants
	"i'll describe it",
	"let me describe",
	"let me explain",
	"let me type it",
	"describe it",
	"i'll type it",
	"i'll write it",
	"i'd prefer to describe it",
	// dismissal
	"skip",
	"skip this question",
	"next",
	"don't bother",
	// no-op / no preference
	"prefer not to say",
	"rather not say",
	"no preference",
	"no strong preference",
	// not applicable
	"not applicable",
	"n/a",
	"n/a (doesn't apply)",
]);

// Drop blacklisted answers from a question's set (don't block the tool call)
export function sanitizeAnswers(answers: string[]): string[] {
	return answers.filter((a) => !ANSWER_BLACKLIST.has(a.trim().toLowerCase()));
}

// Runtime schema for the ask tool parameters
export const AskParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			kind: StringEnum(["single", "multiple"] as const),
			question: Type.String({ description: "The question text to ask" }),
			answers: Type.Array(Type.String({ description: "Answer choices" })),
		}),
	),
});
