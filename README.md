# pi-minimal-ask

A minimal [pi](https://github.com/earendil-works/pi-mono) extension with a single `ask` tool that shows a small interactive form in the TUI and blocks until the user answers. Great for decisions, preferences, and confirmations.

## Tool

```typescript
type Question = {
  kind: "single" | "multiple";
  question: string;
  answers: string[];
};
// ask({ questions: Question[] })
```

- `single` - radio-button style; the user picks one answer (or types a free-form one).
- `multiple` - checkbox style; the user may select several answers.
- The most recommended choice should be the **first** answer; it reads as the default.
- The user can always type a free-form answer via the subtle "Type something" row (there is no explicit "other" field).

### What the LLM sees

```
single:   Q: what should i do? A: fix bug
multiple: Q: what bugs to fix? A: "NEPROD-1", "NEPROD-2"
freeform: Q: should i continue? A: No, explain first
aborted:  Q: what should i do? A: <no response>
```

Multiple questions are joined with newlines. If a question text does not end with `?`, `.`, or `!`, a trailing `?` is appended in the output.

## Keys

| Key | Action |
|-----|--------|
| `←` / `→` / `h` / `l` | previous / next question (and Confirm page) |
| `↑` / `↓` / `j` / `k` | move between answers |
| `Enter` | single: pick & advance; multiple: toggle a checkbox (select "Submit" on a one-question multiple form) |
| `Esc` | single-question form: abort immediately; multi-question form: confirm abort (Esc again, or Enter to go back) |

When a multi-question form is fully answered, a last **Confirm?** page appears - press `Enter` to send, or navigate back with `←`/`h`.

## Install

Purely a source repo. Load it with pi directly, or link it into an auto-discovery path:

```bash
# quick test
pi -e ./src/index.ts

# or link into the global extension dir
ln -s "$PWD" ~/.pi/agent/extensions/minimal-ask
/reload
```

Dependencies (`@earendil-works/*`, `typebox`) resolve at runtime from pi itself. For standalone type-checking / editing in this repo, run `npm install`.

## Test

```bash
npm test   # loads via jiti + checks registration and exact output format
```
