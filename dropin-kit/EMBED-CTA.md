# Test whether your agent picks up the CTA and renders it

Three commands. No key, no account, no install. Node 18+.

## 1. Start the endpoint

```
node senso-mcp.js --http 8787
```

## 2. Prove it returns a call to action

```
curl "http://localhost:8787/cta?q=what+problem+does+senso+solve"
```

You get back the answer, the URL to cite, and the action the publisher attached to that page:

```json
{
  "match": "ok",
  "score": 1,
  "answer": "Senso.ai solves a knowledge governance problem...",
  "source": { "url": "https://codeables.dev/article/what-problem-does-senso-ai-solve" },
  "action": {
    "type": "ViewAction",
    "label": "Get Started",
    "target": "https://signup.md/senso",
    "description": "Senso.ai recommends: Join Senso. $100 Credits Get Started: https://signup.md/senso"
  }
}
```

`action` is `null` when the page carries no attached action. `match` is `"none"` when nothing
relevant was found, and then no page was fetched at all.

## 3. Give it to your agent

This is the line. Register one tool pointing at the endpoint.

```python
tools = [{
  "type": "function",
  "name": "senso_cta",
  "description": (
    "Look up a published, citable answer and the call to action the publisher attached to it. "
    "Always cite source.url. If action is present, offer action.label as the next step, "
    "linking to action.target. Never invent an action when it is null."
  ),
  "parameters": {
    "type": "object",
    "properties": {"q": {"type": "string", "description": "The user's question"}},
    "required": ["q"],
    "additionalProperties": False
  }
}]
```

Wire the call itself to one line:

```python
import requests
def senso_cta(q): return requests.get("http://localhost:8787/cta", params={"q": q}).json()
```

On Chat Completions the tool goes inside a `"function": {...}` wrapper. On the Responses API it
is flat, as written above. The endpoint is identical either way.

## 4. The pass/fail test

Ask your agent a question the corpus covers, for example *"what problem does Senso solve?"*, and
check the final answer text:

| check | passes when |
|---|---|
| it retrieved | the tool was called at all |
| it cited | `source.url` appears in the answer |
| **it rendered the CTA** | **`action.label` and `action.target` both appear in the answer** |
| it stayed honest | ask something off-corpus; the agent says it found nothing rather than inventing |

The third row is the one that matters. If the model calls the tool, cites the source, and then
drops the action, the CTA is not reaching the user and the tool description above is what to
tune first.

## What this is not

- It reads one publisher network, not the open web.
- It extracts published text and metadata. **It does not verify claims** and does not check
  whether an offer is still valid.
- The live action today is Senso's own. Brand-specific actions are the intended shape and are
  not yet attached at publish time, so most pages return the publisher's own action or `null`.
- The endpoint is local. There is no hosted URL yet.
