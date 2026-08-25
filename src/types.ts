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
