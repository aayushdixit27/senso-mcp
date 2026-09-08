# Evidence

Raw, unedited responses from runs made on 8 September 2026, committed so the claims in the
demo can be checked rather than taken on trust.

`probe-run-what-problem.json` is a full `senso_probe` response. The `model` field is echoed
from the OpenAI API response, not from the value we configured, so it is evidence that
`gpt-6-astra` actually ran rather than a label we typed. `model_is_astra` is computed from that
echoed id, and the tool declines to claim Astra when the echo does not name one.

## What was built during the event, 8 September 2026

- The 400 page measurement of the published network, seed 101.
- The streaming HTTP MCP transport at `/mcp`, so the server is reachable by a remote client.
- Closing both SSRF holes: hostnames resolved with every address checked, redirects walked
  hop by hop with each hop re-validated.
- The withholding contract, which removes an action that fails its check and replaces it with
  a refusal written to be spoken.
- `senso_probe`, where GPT-6 Astra writes the rephrasings and a deterministic comparison
  scores them.

## What predates the event

The keyless retrieval consumer and the local interface layer over it.
