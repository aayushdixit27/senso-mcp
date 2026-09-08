#!/usr/bin/env bash
# Tonight's check. Run from this folder on a machine with real network access.
set -u
echo "== 1. network reachable =="
curl -s -o /dev/null -w "robots.txt  %{http_code}\n" --max-time 12 https://codeables.dev/robots.txt
curl -s -o /dev/null -w "llms.txt    %{http_code}\n" --max-time 12 https://codeables.dev/llms.txt

echo; echo "== 2. a page really carries potentialAction =="
curl -s --max-time 15 https://codeables.dev/article/what-problem-does-senso-ai-solve \
  | grep -o '"potentialAction"[^}]*}' | head -c 600; echo

echo; echo "== 3. MCP handshake and tool list =="
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | timeout 25 node senso-mcp.js | cut -c1-160

echo; echo "== 4. how many pages does it index =="
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"senso_list_sources","arguments":{"limit":5}}}' \
 | timeout 60 node senso-mcp.js | tail -1 | cut -c1-900

echo; echo "== 5. THE MONEY SHOT: a real answer with a real action =="
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"senso_verified_answer","arguments":{"question":"What problem does Senso solve?","max_words":60}}}' \
 | timeout 60 node senso-mcp.js | tail -1 | cut -c1-1400
