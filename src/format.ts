import type { QA } from "./types.js";

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
