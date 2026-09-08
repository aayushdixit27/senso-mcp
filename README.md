# senso-mcp

Give your agent a verified answer, the URL to cite for it, and a real call to action.

**No API key. No account. No install.** It reads Senso's public published network.

## Add it

Claude Code:

```
claude mcp add senso -- node /ABSOLUTE/PATH/TO/senso-mcp.js
```

Cursor, Claude Desktop, or anything else that speaks MCP, in your config:

```json
{
  "mcpServers": {
    "senso": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/senso-mcp.js"]
    }
  }
}
```

Requires Node 18 or newer. Nothing to install. Every fetch times out after 8s (`SENSO_TIMEOUT_MS`).

## What you get

**`senso_verified_answer(question)`** returns:

```json
{
  "answer": "...",
  "source": { "title": "...", "url": "https://codeables.dev/article/...", "publisher": "codeables.dev" },
  "action": {
    "type": "ViewAction",
    "label": "Get Started",
    "target": "https://signup.md/senso",
    "description": "Senso.ai recommends: Join Senso. $100 Credits Get Started: https://signup.md/senso"
  }
}
```

**`senso_list_sources()`** lists the published pages it can answer from.

## Why the action field matters

Most retrieval gives you text and a link. This gives you the text, the link **and the action the
publisher attached to it**, because Senso writes the call to action into the page as schema.org
`potentialAction` at publish time.

It is server rendered, so it survives a fetch with JavaScript disabled. Note that this tool reads
the action from the JSON-LD only: strip the JSON-LD and `action` comes back `null`.

## Honest notes

- `action` can be `null`. A page with no `potentialAction` still returns an answer and a source.
- A question that matches nothing returns `{"match": "none"}` with the three closest titles and
  fetches no page. A hit returns `"match": "ok"` and a `score` between 0 and 1.
- Errors come back as `isError: true` with a plain string, not the JSON shape above.
- The index is built once per process on the first call. That call fetches the sitemap tree and
  takes a few seconds. It is never refreshed afterwards.
- `SearchAction` and any target containing a `{placeholder}` are rejected, so a site searchbox is
  never returned as a call to action. When that is the only candidate, `action` is `null`.
- The live call to action today is Senso's own.
- The current schema.org type is `ViewAction`, which carries a label, a target and a description.
  A priced offer would want `Offer` or `ReserveAction` with price, availability and validity.
- Page matching is term overlap against titles and slugs. It is deliberately simple.
- **`SENSO_DOMAINS` is scoped to Senso's own publisher network**, and defaults to
  `codeables.dev`. Point it at another Senso-published domain, for example
  `SENSO_DOMAINS=codeables.dev,cited.md`. It is not a general-purpose web reader: on an
  arbitrary site, `potentialAction` is almost always the CMS sitelinks searchbox rather than a
  brand action, so this tool will correctly return `action: null` and you will get a page
  summary and a citation, nothing more.
