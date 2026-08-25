# pi-minimal-ask

## tools
The extension has a single tool `ask` with parameters:
```typescript
type Question = {
    kind: "single" | "multiple"
    question: string,
    answers: string[]
}
type Params = Question[]
```

## ui
### tui form
when the agent asks question(s) to the user, show a interactive form.
- left/right/h/l to go to prev/next question
- down/up/j/k to select answer
- enter to confirm answer
- esc to abort

- When there is only one question, when you press enter to confirm, close the form and respond to the agent.
- When there are multiple questions, all of them are confirmed, show a last "Confirm?" page where if you press enter again, the response is sent to the agent
    - Aborting a multiple question form requires confirmation (double esc), press enter to go back and answer
    - The "Confirm?" page is just a page that can be navigated back and forth to with left/right/h/l

The form should look something like this and go "in front" of the input box and footer:
```
<Question1> <Question2> <Question3> <Confirm?>
1. Answer 1
2. Answer 2
3. Answer 3
```

For single question:
```
<Question1>
1. Answer 1
2. Answer 2
3. Answer 3
```

And for multiple answers (use nerd font):
```
<Question1>
1. 󰄱 Answer 1
2. 󰱒 Answer 2
3. 󰱒 Answer 3
```

- Highlight the current question (with accent)
- Unselected questions should have their title trimmed to make space for the current one
- Highlight the selected answer(s)
- Show a checkmark on answered questions
- When you confirm a question, go automatically to the next
- The tool call is blocking until user submits

### human tool call
the human tool call render should just look like this:
```
ask <question> (<single|multiple>)
```
the question text should be fg color, and the `(<single|multiple>)` part should be dim color.

when tools are expanded, also show the Q/A text, which is exactly what the model sees (later section).

## guidance
Provide very short and token efficient guidance.
- use `single` kind for radio button style logic
- use `multiple` when the user can select multiple answers
- show the most recommended choice as the first answer
- the user will have the choice to write a free-form answer; do not add a "other" or similar field

## examples
single choice
- `ask([question: "what should i do?", kind: "single", answers: ["fix bug", "review code"]])` (pseudocode)
- user selects "fix bug"
- LLM sees: "Q: What should i do? A: fix bug"

multiple choice
- `ask([question: "what bugs to fix?", kind: "multiple", answers: ["NEPROD-1", "NEPROD-2", "NEPROD-3"]])` (pseudocode)
- user selects `NEPROD-1`, `NEPROD-2`
- LLM sees: `Q: what bugs to fix? A: "NEPROD-1", "NEPROD-2"`

single choice but respond freeform
- `ask([question: "should i continue", kind: "single", answers: ["yes", "no"]])` (pseudocode)
- user responds freeform `No, explain first` 
- LLM sees: `Q: should i continue? A: No, explain first`

two single choice questions
- `ask([{question: "what should i do?", kind: "single", answers: ["fix bug", "review code"]}, {question: "should i continue", kind: "single", answers: ["yes", "no"]}])` (pseudocode)
- user responds "fix bug" and "yes"
- LLM sees: `Q: what should i do? A: fix bug\nQ: should i continue? A: yes`

user aborted
- `ask([question: "what should i do?", kind: "single", answers: ["fix bug", "review code"]])` (pseudocode)
- user quits form
- LLM sees: "Q: What should i do? A: <no response>"
