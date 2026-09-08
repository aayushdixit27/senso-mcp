# Build path, 60 to 90 minutes

Only start this after a FIT or an accepted PARTIAL FIT, and after `verify.sh` exits 0.

Four boxes. Check in with the builder at the end of each. If a box runs over its budget, say so
and cut scope rather than pushing on silently.

## Box 1, 10 minutes. Wire the server in

Register it with whatever the builder is using. Use an absolute path.

Claude Code:
```
claude mcp add senso -- node /ABS/PATH/dropin-kit/senso-mcp.js
```

Codex, Cursor, Claude Desktop, or any MCP client, in config:
```json
{ "mcpServers": { "senso": { "command": "node", "args": ["/ABS/PATH/dropin-kit/senso-mcp.js"] } } }
```

Not using MCP at all? It speaks newline-delimited JSON-RPC 2.0 on stdio, so spawn it as a
child process and write one JSON object per line. Do not add an SDK for this.

**Done when:** the client lists `senso_verified_answer` and `senso_list_sources`.

## Box 2, 15 minutes. One real call, end to end

Call `senso_verified_answer` with a question the builder actually cares about. Parse
`content[0].text` as JSON. Guard the parse: on failure you get `isError: true` and a plain
string.

Read these fields in this order and handle each:

| field | what to do |
|---|---|
| `match` | `"none"` means no relevant page and nothing was fetched. Show the miss, use `closest`. |
| `score` | 0 to 1, title and slug overlap. Low means weak. Decide your own floor. |
| `answer` | the text. `answer_source` says whether it is publisher-declared or scraped. |
| `source.url` | cite this. Always present on a hit. |
| `action` | may be `null`. Never fabricate one. |

**Done when:** the builder has seen a real answer, a real citation and a real action in their
own project, not in a terminal.

## Box 3, 25 minutes. Put it where the user sees it

The integration that earns its place: answer the question, cite the source, and offer the
publisher's action as the next step.

Three patterns that work, pick one:

- **Cited answer.** Render `answer`, then `source.url` as a visible citation. Cheapest, works
  everywhere, and is the honest baseline.
- **Answer plus next step.** Same, plus `action.label` as a button pointing at `action.target`.
  This is the one that demos well, because the agent ends with something to do rather than a
  wall of text.
- **Grounding check.** Before your own model answers, call this and pass `answer` in as
  context. Cite `source.url`. Use `score` to decide whether to trust it.

**Done when:** a person who is not the builder can use it without narration.

## Box 4, 10 to 30 minutes. Make it survive the demo

Non-negotiable, in this order:

1. **Handle `match: "none"` visibly.** Someone will ask an off-topic question in front of a
   judge. The honest miss is a feature; show it.
2. **Handle `action: null`.** Do not render an empty button.
3. **Handle the first-call delay.** The index builds once per process from a sitemap and takes
   a few seconds. Warm it at startup with `senso_list_sources`, or show a spinner.
4. **Handle a timeout.** Every fetch aborts after 8s and returns a clear message. Catch it.

**Done when:** the builder has personally typed a nonsense question and an off-corpus question
into their own UI and both looked deliberate.

## If you finish early

Do not add features. Write the two sentences the builder will say when demoing: what it does,
and where the answer and the action came from. That is worth more than another endpoint.
