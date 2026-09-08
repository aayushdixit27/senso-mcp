# senso-mcp drop-in kit

Give your agent a verified answer, the URL to cite for it, and the call to action the
publisher attached to that page. No API key, no account, no install.

## Use it in 30 seconds

Drop this folder into your repo, then tell your coding agent:

```
Read AGENTS.md in ./dropin-kit and follow it.
```

Codex reads `AGENTS.md` on its own. Claude Code, Cursor and anything else: paste the line above.

Your agent will ask what you are building, decide whether this is actually a fit, and say so
plainly if it is not. **If it is not a fit you will know inside two minutes**, which is the
point. Nobody has an hour to waste at a hackathon.

If it is a fit, it walks you to a working integration in 60 to 90 minutes.

## What is in here

| file | what it is |
|---|---|
| `AGENTS.md` | what your coding agent reads first |
| `FIT-CHECK.md` | the fit rubric, run before any code |
| `BUILD-60.md` | the timeboxed build path, once fit is confirmed |
| `senso-mcp.js` | the MCP server itself, 0 dependencies, single file |
| `verify.sh` | proves the server works on your machine before you build on it |

## The one thing to know before you start

This reads **one publisher network**, not the open web. It covers 12 industries and 106
verticals, roughly 8000 pages, spanning AI and dev tooling, SaaS, financial services,
healthcare services, travel and transportation, and others. It is not a search engine and it
will not answer questions outside that corpus. `FIT-CHECK.md` is how you find out in two
minutes whether your idea lands inside it.

Requires Node 18 or newer.
