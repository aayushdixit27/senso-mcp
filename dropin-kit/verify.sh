#!/usr/bin/env bash
# Proves senso-mcp works on THIS machine before you build on it.
# Exits non-zero on the first real failure and says what broke.
set -uo pipefail
cd "$(dirname "$0")"
FAIL=0
pass() { printf "  ok    %s\n" "$1"; }
fail() { printf "  FAIL  %s\n" "$1"; FAIL=1; }

echo "senso-mcp verify"
echo

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 18 ] && pass "node $(node -v)" || fail "node 18+ required, found ${NODE_MAJOR:-none}"

node --check senso-mcp.js 2>/dev/null && pass "senso-mcp.js parses" || fail "senso-mcp.js has a syntax error"

# The server tracks in-flight work and exits only when it is done, so stdin can close
# immediately. No sleeps, which keeps this script under ten seconds.
call() { # $1 = json-rpc line
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "$1" \
    | node senso-mcp.js 2>/dev/null | tail -1
}

OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' 1)
echo "$OUT" | grep -q senso_verified_answer && pass "tools/list advertises senso_verified_answer" \
  || fail "tools/list did not return the tools"

echo "  ...building the index, this fetches a sitemap and takes a few seconds"
OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"senso_list_sources","arguments":{"limit":1}}}' )
if echo "$OUT" | grep -q '"isError"'; then
  fail "could not reach the corpus. Network blocked, or the site is down."
  echo "        $(echo "$OUT" | grep -o '"text":"[^"]*"' | cut -c1-120)"
else
  COUNT=$(echo "$OUT" | grep -o '\\"count\\": [0-9]*' | grep -o '[0-9]*' | head -1)
  [ "${COUNT:-0}" -gt 100 ] && pass "indexed ${COUNT} pages" || fail "indexed only ${COUNT:-0} pages, expected thousands"
fi

OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"senso_verified_answer","arguments":{"question":"What problem does Senso solve?","max_words":40}}}' )
echo "$OUT" | grep -q '\\"match\\": \\"ok\\"' && pass "a real question returns a hit" || fail "expected match ok"
echo "$OUT" | grep -q '\\"url\\"' && pass "the hit carries a citable source.url" || fail "no source.url in the answer"
echo "$OUT" | grep -q '\\"target\\"' && pass "the hit carries an action.target" \
  || printf "  note  no action on this page. action can be null, this is not a failure.\n"

OUT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"senso_verified_answer","arguments":{"question":"zzqq nonsense xyzzy"}}}' )
echo "$OUT" | grep -q '\\"match\\": \\"none\\"' && pass "an off-topic question returns an honest miss" \
  || fail "off-topic question did not return match none. The relevance floor is not working."

echo
if [ "$FAIL" -eq 0 ]; then echo "All checks passed. Go to BUILD-60.md."; else
  echo "Something failed above. Do not build on this until it is fixed."; fi
exit "$FAIL"
