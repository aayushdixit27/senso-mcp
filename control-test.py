#!/usr/bin/env python3
"""
Control test for the acceptance contract in "OpenAI Hackathon - team and agent execution
plan - September 8", KB node 8c2d7c2d-9890-445f-8c45-2a73cb2e98a0, section 6.

Why this exists. The execution plan records revision 2 as the last independently tested
implementation. Revisions 3 through 6 changed the relevance floor, added action
verification and changed the acceptance suite, and none of that was run end to end
against the contract. Structural checks passing is not the same as the contract passing.

What it does. It resolves the contract's four surfaces for one page and compares them:
  1. management configuration   GET /org/ctas default_cta
  2. visible public card        the rendered CTA block in raw public HTML
  3. structured action          schema.org potentialAction in the same HTML
  4. consumer result            the local keyless endpoint

"Action delivery" in the contract passes only when all four agree. Any surface that
cannot be read is reported as unreadable and never as a pass. A check that cannot run
is not a failure of the thing being checked, and it is never scored as a pass.

Read-only. No page is published, republished or edited. The org key is used for one
GET and is never printed.
"""
import json, os, re, sys, urllib.request, urllib.error, urllib.parse

BASE = os.environ.get("CTA_BASE", "http://localhost:8899")
KEY = os.environ.get("SENSO_API_KEY", "")
QUESTION = "What makes documentation readable by AI agents?"
EXPECTED_LABEL = "Build your first agentic CTA"
EXPECTED_TARGET = "https://docs.senso.ai/"
PAGE = "https://codeables.dev/article/what-makes-documentation-readable-by-ai-agents"
UA = {"User-Agent": "senso-control-test/1.0"}

def get(url, headers=None, timeout=45):
    r = urllib.request.Request(url, headers={**UA, **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as f:
            return f.status, f.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return None, str(e)

results = []
def record(name, state, detail):
    results.append((name, state, detail))

# ---- surface 1: management configuration
mgmt = None
if not KEY:
    record("surface 1, management configuration", "UNREADABLE", "SENSO_API_KEY not in env")
else:
    code, body = get("https://apiv2.senso.ai/api/v1/org/ctas", {"X-API-Key": KEY})
    if code != 200:
        record("surface 1, management configuration", "UNREADABLE", f"GET /org/ctas returned {code}")
    else:
        dc = (json.loads(body).get("default_cta") or {})
        mgmt = (dc.get("button_label"), dc.get("target_url"))
        record("surface 1, management configuration", "READ", f"{mgmt[0]} -> {mgmt[1]}")

# ---- surfaces 2 and 3: the public page
code, html = get(PAGE)
visible = structured = None
if code != 200:
    record("surface 2, visible public card", "UNREADABLE", f"page returned {code}")
    record("surface 3, structured action", "UNREADABLE", f"page returned {code}")
else:
    blocks = re.findall(r'<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>', html, re.I)
    found = []
    def walk(o):
        if isinstance(o, dict):
            pa = o.get("potentialAction")
            if pa:
                for a in (pa if isinstance(pa, list) else [pa]):
                    if isinstance(a, dict): found.append(a)
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    for b in blocks:
        try: walk(json.loads(b))
        except Exception: pass
    if found:
        structured = (found[0].get("name"), found[0].get("target"))
        record("surface 3, structured action", "READ", f"{structured[0]} -> {structured[1]}")
    else:
        record("surface 3, structured action", "UNREADABLE", "no potentialAction in the page")

    # The visible card. The CTA anchor wraps an inline SVG icon, so the label is a leading text
    # node rather than the whole element body. An earlier version of this bounded the inner
    # match to 120 characters and silently found nothing, which is exactly the failure this
    # test exists to catch: it reported UNREADABLE for a card that was plainly in the HTML.
    cand = []
    for m in re.finditer(r'<a\b([^>]*)>([\s\S]*?)</a>', html, re.I):
        attrs, inner = m.group(1), m.group(2)
        hm = re.search(r'href="([^"]+)"', attrs, re.I)
        if not hm: continue
        href = hm.group(1).replace('&amp;', '&')
        label = re.sub(r'<[^>]+>', ' ', inner)
        label = re.sub(r'\s+', ' ', label).strip()
        if label and len(label) < 60 and re.search(r'calendly|docs\.senso|signup\.md', href, re.I):
            cand.append((href, label))
    # Ambiguity is reported, never resolved by picking the first hit. The match is a heuristic
    # over destination families, so a footer or unrelated link can satisfy it. Two distinct
    # candidates means this surface cannot be read, not that the first one is the card.
    distinct = {(h, l) for h, l in cand}
    if len(distinct) == 1:
        href, label = cand[0]
        visible = (label, href)
        record("surface 2, visible public card", "READ", f"{visible[0]} -> {visible[1]}")
    elif len(distinct) > 1:
        record("surface 2, visible public card", "UNVERIFIABLE",
               f"{len(distinct)} distinct candidate anchors matched the heuristic; not guessing which is the card: {sorted(distinct)[:3]}")
    else:
        record("surface 2, visible public card", "UNREADABLE", "no CTA anchor matched in raw HTML")

# ---- surface 4: the consumer
import urllib.parse
code, body = get(f"{BASE}/cta?q=" + urllib.parse.quote(QUESTION), timeout=180)
consumer = None; consumer_src = None
if code != 200:
    record("surface 4, consumer result", "UNREADABLE", f"endpoint returned {code}: {body[:80]}")
else:
    d = json.loads(body)
    a = d.get("action") or {}
    consumer_src = (d.get("source") or {}).get("url")
    if a:
        consumer = (a.get("label"), a.get("target"))
        record("surface 4, consumer result", "READ",
               f"{consumer[0]} -> {consumer[1]}  [verified={(a.get('verified') or {}).get('status')}, shape={a.get('target_shape')}, usable={a.get('usable')}]")
    else:
        record("surface 4, consumer result", "READ", "no action returned")

print("=" * 78)
print("CONTROL TEST: execution plan section 6 acceptance contract")
print("page:", PAGE)
print("question:", QUESTION)
print("=" * 78)
for n, s, d in results:
    print(f"  [{s:10}] {n}\n               {d}")

print("\n" + "-" * 78)
print("CONTRACT CHECKS")
print("-" * 78)
def verdict(name, state, why):
    print(f"  [{state:11}] {name}\n                {why}")

# Surface 1 reads the ORG DEFAULT. That is the right comparison only if this page inherits it.
# No endpoint was found that exposes a page's CTA mode (inherit, assigned, off) or its resolved
# effective card, so that cannot be asserted here. The management application displays the page
# as Default, which is a screen reading rather than a backend fact.
verdict("Page CTA mode (inherit / assigned / off)", "UNVERIFIABLE",
        "no API surface found that exposes per-page CTA mode or the resolved effective card; "
        "surface 1 is the ORG DEFAULT and is the right comparison only if this page inherits")

# source correctness
if consumer_src is None:
    verdict("Source correctness", "UNVERIFIABLE", "consumer surface could not be read")
elif consumer_src.rstrip('/') == PAGE.rstrip('/'):
    verdict("Source correctness", "PASS", f"returned the agreed source: {consumer_src}")
else:
    verdict("Source correctness", "FAIL", f"returned {consumer_src}, expected {PAGE}")

# Expected pair, asserted per surface and SEPARATELY from cross-surface agreement. Four
# surfaces can agree perfectly on the wrong action, and that must not read as a pass.
print()
for nm, pair in (("management", mgmt), ("visible", visible), ("structured", structured), ("consumer", consumer)):
    if not pair:
        verdict(f"Expected pair, {nm}", "UNVERIFIABLE", "surface not readable")
        continue
    lab_ok = pair[0].strip() == EXPECTED_LABEL
    tgt = pair[1].strip()
    tgt_ok = tgt.rstrip('/') == EXPECTED_TARGET.rstrip('/')
    if lab_ok and tgt_ok:
        verdict(f"Expected pair, {nm}", "PASS", f"{EXPECTED_LABEL} -> {EXPECTED_TARGET}")
    else:
        verdict(f"Expected pair, {nm}", "FAIL", f"got {pair[0]} -> {pair[1]}")

# action delivery: all four must agree
readable = [x for x in (mgmt, visible, structured, consumer) if x]
if len(readable) < 4:
    verdict("Action delivery", "UNVERIFIABLE",
            f"only {len(readable)} of 4 surfaces readable; a surface that cannot be read is never a pass")
else:
    # Normalise only what is genuinely case-insensitive: scheme and host. Path and query are
    # left alone, because a path case difference or a dropped query parameter can change where
    # the reader actually lands. Lowercasing the whole URL and stripping the query, as an
    # earlier version did, can hide a material difference and report agreement that is not real.
    def norm(pair):
        label, target = str(pair[0]).strip(), str(pair[1]).strip()
        try:
            u = urllib.parse.urlsplit(target)
            target = urllib.parse.urlunsplit((u.scheme.lower(), u.netloc.lower(), u.path or '/', u.query, ''))
        except Exception:
            pass
        return (label, target)
    s = {norm(mgmt), norm(visible), norm(structured), norm(consumer)}
    if len(s) == 1:
        verdict("Action delivery", "PASS", "all four surfaces agree")
    else:
        verdict("Action delivery", "FAIL", f"{len(s)} distinct label/target pairs across four surfaces")
        for nm, p in (("management", mgmt), ("visible", visible), ("structured", structured), ("consumer", consumer)):
            print(f"                  {nm:12} {p[0]} -> {p[1]}")
