// Smoke test: loads the extension via jiti (pi's loader) with the global pi
// packages aliased in, then checks tool registration and the exact LLM-visible
// output format from the spec.
import { createJiti } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs";

const PI = "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": PI,
		"@earendil-works/pi-tui": `${PI}/node_modules/@earendil-works/pi-tui`,
		"@earendil-works/pi-ai": `${PI}/node_modules/@earendil-works/pi-ai`,
		typebox: `${PI}/node_modules/typebox/build/index.mjs`,
	},
});

const mod = await jiti.import(new URL("../index.ts", import.meta.url).href);
const factory = mod.default;
const { formatAnswer } = mod;

let failures = 0;
function check(name, actual, expected) {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`}`);
}

console.log("== registration ==");
if (typeof factory !== "function") {
	console.log("FAIL default export is not a function");
	process.exit(1);
}
let captured;
factory({ registerTool: (def) => (captured = def) });
check("tool name", captured?.name, "ask");
check("tool label", captured?.label, "Ask");
check("has parameters schema", typeof captured?.parameters, "object");
check("has renderCall", typeof captured?.renderCall, "function");
check("has renderResult", typeof captured?.renderResult, "function");
check("has execute", typeof captured?.execute, "function");

const schema = JSON.parse(JSON.stringify(captured.parameters));
check("params.questions is array", schema.properties?.questions?.type, "array");
check("params item has kind enum", Array.isArray(schema.properties?.questions?.items?.properties?.kind?.enum), true);

console.log("\n== output format (spec examples) ==");
check(
	"single",
	formatAnswer({ question: "what should i do?", kind: "single", answers: ["fix bug", "review code"], selected: ["fix bug"] }),
	"Q: what should i do? A: fix bug",
);
check(
	"multiple",
	formatAnswer({ question: "what bugs to fix?", kind: "multiple", answers: ["NEPROD-1", "NEPROD-2", "NEPROD-3"], selected: ["NEPROD-1", "NEPROD-2"] }),
	'Q: what bugs to fix? A: "NEPROD-1", "NEPROD-2"',
);
check(
	"freeform",
	formatAnswer({ question: "should i continue", kind: "single", answers: ["yes", "no"], selected: [], custom: "No, explain first" }),
	"Q: should i continue? A: No, explain first",
);
check(
	"no response",
	formatAnswer({ question: "what should i do?", kind: "single", answers: ["fix bug", "review code"], selected: [] }),
	"Q: what should i do? A: <no response>",
);

console.log("\n== rendering ==");
const fakeTheme = {
	fg: (_c, s) => s,
	bg: (_c, s) => s,
	bold: (s) => s,
};
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const renderText = (t, w = 80) => strip(t.render(w).join("\n").replace(/\s+$/gm, ""));

check(
	"renderCall single",
	renderText(captured.renderCall({ questions: [{ kind: "single", question: "what should i do?", answers: ["fix bug"] }] }, fakeTheme, undefined)),
	"ask what should i do? (single)",
);

check(
	"renderCall multi has +1",
	renderText(captured.renderCall({ questions: [{ kind: "single", question: "q1", answers: ["a"] }, { kind: "multiple", question: "q2", answers: ["b"] }] }, fakeTheme, undefined)),
	"ask q1 (single) +1",
);

check(
	"renderResult expanded = model text",
	renderText(
		captured.renderResult(
			{
				content: [{ type: "text", text: "Q: what should i do? A: fix bug" }],
				details: { answers: [{ question: "what should i do?", kind: "single", answers: ["fix bug", "review code"], selected: ["fix bug"] }], cancelled: false },
			},
			{ expanded: true },
			fakeTheme,
			undefined,
		),
		100,
	),
	"Q: what should i do? A: fix bug",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
