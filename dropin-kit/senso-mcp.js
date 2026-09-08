#!/usr/bin/env node
// senso-mcp: give any agent a verified answer, its citation, and a real call to action.
// No API key. No account. No install. Reads Senso's public published network.
//   node senso-mcp.js
// Env: SENSO_DOMAINS comma separated, default "codeables.dev,cited.md" (the live Senso network)
//      SENSO_MIN_SCORE relevance floor, default 0.5

const DOMAINS = (process.env.SENSO_DOMAINS || 'codeables.dev,cited.md')
  .split(',').map(s => s.trim()).filter(Boolean);
const UA = 'senso-mcp/0.1 (+https://senso.ai)';
const STOP = new Set(['the','a','an','of','for','to','in','on','and','or','is','are','what','how','why','do','does','can','i','my','with','best','vs']);
// llms.txt on this network lists industries and verticals only, so the sitemaps carry the
// articles. Fetching them serially exceeded the caller's timeout; the concurrency below is
// what fixed that. The limit is only a safety valve for domains with far more sitemaps.
const SUB_SITEMAP_LIMIT = Number(process.env.SENSO_SUB_SITEMAPS || 120);
const FETCH_CONCURRENCY = Number(process.env.SENSO_CONCURRENCY || 12);
const FETCH_TIMEOUT_MS = Number(process.env.SENSO_TIMEOUT_MS || 8000);
// Relevance floor. Observed on the four live publisher pages used in testing: correct matches scored
// 0.89 to 1.0, the known-wrong Sun Life match scored 0.2. 0.5 separates them here. That is a
// 4-positive plus 1-negative sample, so treat this default as provisional and tune it with
// real fixtures.
//
// The value is validated rather than coerced. A bare Number() is unsafe here in three ways,
// each of which silently weakens the floor instead of failing loudly:
//   "abc" -> NaN, and every comparison against NaN is false, so the floor stops rejecting
//            anything at all.
//   "0"   -> 0, which admits a candidate that shares no words with the question.
//   "-1"  -> -1, same, and it cannot be reached by any real score.
// Out-of-range values fall back to the default and say so on stderr. Zero-overlap rejection
// below does not consult this value, so it holds no matter what is configured.
const MIN_SCORE_DEFAULT = 0.5;
const MIN_SCORE = (() => {
  const raw = process.env.SENSO_MIN_SCORE;
  if (raw === undefined || raw === '') return MIN_SCORE_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    console.error(`senso-mcp: SENSO_MIN_SCORE=${JSON.stringify(raw)} must be a number greater than 0 and at most 1. Using the default ${MIN_SCORE_DEFAULT}.`);
    return MIN_SCORE_DEFAULT;
  }
  return n;
})();
// potentialAction on the open web is dominated by CMS searchbox boilerplate. Returning one
// as a brand call to action is worse than returning nothing.
const EXCLUDED_ACTION_TYPES = new Set(['SearchAction']);
const PLACEHOLDER_IN_URL = /\{[^}]*\}/;

// ---------- action integrity ----------
// Why this exists. A random sample of 400 of the 8,955 article pages on this network, seed
// 101, showed that the declared next step is almost never a usable one: 347 carried "Explore
// Codeables" pointing at the site root, 15 carried "Explore Cited.md" pointing at its site
// root, 28 carried "Get Started" pointing at https://signup.md/senso, which returns 404, and
// 10 declared none. Zero carried a next step that both resolved and said something the
// citation URL had not already said.
//
// Read the 28 correctly. They are 28 sampled pages sharing ONE broken target, not 28
// independent failures, so fixing that single URL clears all of them. And 28 of 400 is a
// sample proportion, not an inventory count. Returning any of those as "the action the publisher attached" without
// qualification overstates what the page actually offers.
//
// So the action is returned with a checked status and a classification. Three states, never
// two: a target that times out or refuses the connection is "unreachable", which is not the
// same as "dead". An empty result is an empty result, never an absence.
const VERIFY_ACTIONS = (process.env.SENSO_VERIFY_ACTIONS || '1') !== '0';
const VERIFY_TIMEOUT_MS = Number(process.env.SENSO_VERIFY_TIMEOUT_MS || 6000);

// The endpoint follows URLs harvested from third-party JSON-LD, so a hostile publisher could
// point a potentialAction at cloud metadata or at a service on the loopback interface and use
// this server to reach it. Only http and https are followed, and only to public addresses.
//
// Two holes remain open here and both must be closed before this checker is pointed at
// arbitrary harvested targets, hosted or not. The check reads the hostname as written, so a
// public name that resolves to a private address still passes, and redirects are followed
// without re-checking each hop, so a public URL can redirect into private space.
//
// These are NOT made safe by running locally. Discovery is limited to two fixed publisher
// domains, but those pages supply third-party destinations and those destinations can
// redirect, so a local process can still be walked into private space. Closing them means
// validating the resolved address for the actual connection and for every redirect hop.
const PRIVATE_HOST = /^(localhost$|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;

// Both SSRF holes described above are closed here, because this server is now reachable from
// the public internet and a hostile publisher can point a potentialAction anywhere.
//   Hole 1, a public name that resolves to a private address: the hostname is resolved and
//           every returned address is checked, rather than the literal string being trusted.
//   Hole 2, a redirect into private space: redirects are followed by hand, one hop at a time,
//           and every hop is re-validated before it is fetched.
const dnsp = require('dns').promises;
const net = require('net');
const MAX_REDIRECTS = 5;

function addrIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;          // link local, includes cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier grade NAT
    if (a >= 224) return true;                         // multicast and reserved
    return false;
  }
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('::ffff:')) return addrIsPrivate(s.slice(7));
  if (/^f[cd]/.test(s)) return true;                   // unique local
  if (/^fe[89ab]/.test(s)) return true;                // link local
  return false;
}

// An address that cannot be resolved is not treated as safe. It is refused, because an empty
// DNS answer is "could not tell", never "there is nothing private here".
async function hostResolvesPublic(hostname) {
  let addrs;
  try { addrs = await dnsp.lookup(hostname, { all: true }); }
  catch (e) { return { ok: false, why: `the hostname did not resolve (${e.code || e.message})` }; }
  if (!addrs.length) return { ok: false, why: 'the hostname resolved to no addresses' };
  if (addrs.some(a => addrIsPrivate(a.address))) {
    return { ok: false, why: 'the hostname resolves to a private or loopback address' };
  }
  return { ok: true };
}

function targetIsFetchable(target) {
  let u;
  try { u = new URL(target); } catch { return { ok: false, why: 'target is not a valid absolute URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, why: `scheme ${u.protocol} is not followed` };
  if (PRIVATE_HOST.test(u.hostname)) return { ok: false, why: 'target resolves to a private or loopback address' };
  return { ok: true, url: u };
}

// URL SHAPE ONLY. This is a heuristic about the form of the target URL. It is NOT a
// relevance check and it must never be read as one: it does not know what the page is about,
// what the question was, or whether the destination is the right brand.
//
// The distinction that matters is the publisher's OWN front door. "Explore Codeables" pointing
// at codeables.dev, on a codeables.dev article, repeats the citation and adds nothing. A root
// URL on a DIFFERENT domain is a different thing entirely: the approved onboarding action is
// "Build your first agentic CTA" pointing at https://docs.senso.ai/, which is a root URL and is
// correct. An earlier version of this function collapsed those two cases and would have marked
// the approved action unusable at the exact moment it started working.
function targetShape(target, publisherDomain) {
  const g = targetIsFetchable(target);
  if (!g.ok) return 'unusable';
  const path = g.url.pathname.replace(/\/+$/, '');
  const sameHost = g.url.hostname.replace(/^www\./, '') === String(publisherDomain || '').replace(/^www\./, '');
  if (!path) return sameHost ? 'publisher_root' : 'external_root';
  return sameHost ? 'publisher_path' : 'external_path';
}

async function verifyActionTarget(target) {
  const g = targetIsFetchable(target);
  if (!g.ok) return { status: 'blocked', reason: g.why };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VERIFY_TIMEOUT_MS);
  try {
    let url = g.url;
    let hops = 0;
    while (true) {
      const dns = await hostResolvesPublic(url.hostname);
      if (!dns.ok) {
        return { status: 'blocked', reason: dns.why, blocked_at: hops ? url.href : undefined, redirects: hops };
      }
      let r;
      try {
        r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UA } });
        // some origins answer HEAD with 405 or 501 while serving GET perfectly well
        if (r.status === 405 || r.status === 501) {
          r = await fetch(url, { method: 'GET', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UA } });
        }
      } catch (e) {
        return {
          status: 'unreachable',
          reason: `could not complete the request: ${e.name === 'AbortError' ? `no response within ${VERIFY_TIMEOUT_MS}ms` : e.message}`,
          redirects: hops
        };
      }
      const loc = r.headers.get('location');
      if (r.status >= 300 && r.status < 400 && loc) {
        if (++hops > MAX_REDIRECTS) {
          return { status: 'unreachable', reason: `more than ${MAX_REDIRECTS} redirects`, redirects: hops };
        }
        let next;
        try { next = new URL(loc, url); } catch { return { status: 'dead', http_status: r.status, reason: 'the redirect target is not a valid URL', redirects: hops }; }
        const shape = targetIsFetchable(next.href);
        if (!shape.ok) return { status: 'blocked', reason: `a redirect pointed somewhere that is not followed: ${shape.why}`, blocked_at: next.href, redirects: hops };
        url = next;
        continue;
      }
      return {
        status: r.ok ? 'resolves' : 'dead',
        http_status: r.status,
        final_url: url.href !== target ? url.href : undefined,
        redirects: hops,
        reason: r.ok ? undefined : `the target returned HTTP ${r.status}`
      };
    }
  } finally { clearTimeout(timer); }
}

let INDEX = null;

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w));

async function get(url) {
  let r;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(`Network timeout after ${FETCH_TIMEOUT_MS}ms fetching ${url}. Check your connection.`);
    }
    throw e;
  }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return await r.text();
}

// Build a title+url index from llms.txt AND the sitemap tree.
// llms.txt yields only industry and vertical landing pages here, which carry no
// potentialAction and no article prose, so the sitemaps are merged in every time
// rather than used only when llms.txt returns nothing.
async function buildIndex() {
  const out = [];
  for (const d of DOMAINS) {
    try {
      const txt = await get(`https://${d}/llms.txt`);
      for (const m of txt.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
        out.push({ title: m[1], url: m[2], domain: d });
      }
    } catch {}

    for (const sm of [`https://${d}/sitemap.xml`, `https://${d}/sitemap_index.xml`]) {
      let xml;
      try { xml = await get(sm); } catch { continue; }
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);

      for (const u of locs) {
        if (!/\.xml$/i.test(u)) out.push({ title: slugTitle(u), url: u, domain: d });
      }

      const subs = locs.filter(u => /\.xml$/i.test(u)).slice(0, SUB_SITEMAP_LIMIT);
      for (let i = 0; i < subs.length; i += FETCH_CONCURRENCY) {
        const texts = await Promise.all(
          subs.slice(i, i + FETCH_CONCURRENCY).map(u => get(u).catch(() => null))
        );
        for (const sx of texts) {
          if (!sx) continue;
          for (const m of sx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
            if (!/\.xml$/i.test(m[1])) out.push({ title: slugTitle(m[1]), url: m[1], domain: d });
          }
        }
      }
      if (out.length) break;
    }
  }
  const seen = new Set();
  return out.filter(p => !seen.has(p.url) && seen.add(p.url));
}

function slugTitle(u) {
  try {
    const last = new URL(u).pathname.split('/').filter(Boolean).pop() || u;
    return last.replace(/[-_]+/g, ' ').replace(/\.[a-z]+$/i, '');
  } catch { return u; }
}

function score(q, page) {
  const qt = norm(q), hay = new Set(norm(page.title + ' ' + page.url));
  if (!qt.length) return 0;
  let hit = 0;
  for (const t of qt) if (hay.has(t)) hit++;
  return hit / qt.length;
}

function jsonLdBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch {}
  }
  return out;
}

// Collect every potentialAction in the graph, then pick the first that is a real action.
function collectActions(node, out = [], depth = 0) {
  if (!node || depth > 6) return out;
  if (Array.isArray(node)) { for (const n of node) collectActions(n, out, depth + 1); return out; }
  if (typeof node !== 'object') return out;
  if (node.potentialAction) {
    const list = Array.isArray(node.potentialAction) ? node.potentialAction : [node.potentialAction];
    for (const a of list) if (a && typeof a === 'object') out.push(a);
  }
  for (const k of Object.keys(node)) collectActions(node[k], out, depth + 1);
  return out;
}

function findAction(ld) {
  for (const a of collectActions(ld)) {
    const types = [].concat(a['@type'] || []);
    if (types.some(t => EXCLUDED_ACTION_TYPES.has(t))) continue;
    const t = a.target;
    const target = typeof t === 'string' ? t : (t && (t.urlTemplate || t.url)) || a.url;
    if (!target || typeof target !== 'string') continue;
    // a urlTemplate with a {placeholder} is a search form, not a destination
    if (PLACEHOLDER_IN_URL.test(target)) continue;
    return { type: types[0] || 'Action', label: a.name || 'Open', target, description: a.description || '' };
  }
  return null;
}

// The publisher's own declared summary, when the page ships one. Preferred over scraped
// text because <main> here also wraps the CTA block, breadcrumb and nav, which led the
// answer with "Join Senso $100 Credits Get Started Verified Source Home ...".
function findDescription(node, depth = 0) {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findDescription(n, depth + 1); if (r) return r; } return null; }
  if (typeof node !== 'object') return null;
  const t = node['@type'];
  if (t === 'Article' || t === 'WebPage' || t === 'BlogPosting') {
    const v = node.articleBody || node.description;
    if (typeof v === 'string' && v.trim().length > 80) return v.trim();
  }
  for (const k of Object.keys(node)) { const r = findDescription(node[k], depth + 1); if (r) return r; }
  return null;
}

function articleText(html) {
  let h = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const main = h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i);
  h = main ? main[0] : h;
  return h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function titleOf(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : fallback;
}

async function answer(question, maxWords = 220) {
  if (!INDEX || !INDEX.length) INDEX = await buildIndex();
  if (!INDEX.length) throw new Error('No pages indexed. Check SENSO_DOMAINS and network.');
  const ranked = INDEX.map(p => ({ p, s: score(question, p) })).sort((a, b) => b.s - a.s);
  // Relevance floor. Without it an off-topic question fell through to ranked[0] and returned
  // an arbitrary page as a confident answer. An honest miss beats a wrong hit.
  // Zero overlap is rejected on its own terms, not via the configurable floor, so a
  // misconfigured SENSO_MIN_SCORE can never let a page with no shared words through.
  if (!ranked.length || ranked[0].s <= 0 || ranked[0].s < MIN_SCORE) {
    const best = ranked[0];
    return {
      question,
      match: 'none',
      reason: !ranked.length || best.s === 0
        ? 'no overlap with any indexed page'
        : `best candidate scored ${Number(best.s.toFixed(2))}, below the relevance floor of ${MIN_SCORE}`,
      message: 'No page in the indexed network is a confident match. No page was fetched and no action is returned.',
      best_score: ranked.length ? Number(best.s.toFixed(2)) : 0,
      min_score: MIN_SCORE,
      closest: ranked.slice(0, 3).filter(r => r.s > 0).map(r => ({ title: r.p.title, url: r.p.url, score: Number(r.s.toFixed(2)) }))
    };
  }
  const top = ranked.slice(0, 3).filter(r => r.s > 0);
  const pick = top[0].p;
  const html = await get(pick.url);
  const ld = jsonLdBlocks(html);
  const action = findAction(ld);
  // Check the declared next step before handing it to a caller who may act on it. An agent
  // that follows an unverified action sends a person to whatever is on the other end.
  if (action && VERIFY_ACTIONS) {
    // Three separate facts, deliberately not collapsed into one: can the target be reached,
    // what shape is the URL, and is it eligible to show. Eligibility excludes only the
    // publisher's own front door, which repeats the citation. It is NOT a relevance claim.
    action.target_shape = targetShape(action.target, pick.domain);
    action.verified = await verifyActionTarget(action.target);
    action.usable = action.verified.status === 'resolves' && action.target_shape !== 'publisher_root';
    action.usable_note = 'usable means the target responded and is not the publisher\'s own site root. It is not a check that the destination is relevant to the question or the right brand.';
  }
  const declared = findDescription(ld);
  const body = declared || articleText(html);
  const words = body.split(' ');
  const passed = !!(action && action.usable);
  return {
    question,
    match: 'ok',
    score: Number(top[0].s.toFixed(2)),
    answer: words.slice(0, maxWords).join(' ') + (words.length > maxWords ? ' ...' : ''),
    source: { title: titleOf(html, pick.title), url: pick.url, publisher: pick.domain },
    answer_source: declared ? 'schema.org description declared by the publisher' : 'page text',
    action: passed ? action : null,
    action_withheld: passed || !action ? null : {
      label: action.label,
      status: action.verified ? action.verified.status : 'unchecked',
      http_status: action.verified ? action.verified.http_status : undefined,
      checked_url: action.target,
      say_this: spokenRefusal(action)
    },
    also_considered: top.slice(1).map(r => ({ title: r.p.title, url: r.p.url })),
    note: action ? 'Action extracted from schema.org potentialAction in the page, server rendered, no key used.'
                 : 'No potentialAction found on this page.',
    action_note: !action ? 'This page declares no next step. None was invented.'
      : passed ? 'The declared next step was requested over HTTP and responded, and it is not the publisher\'s own site root. Whether it is relevant to this question, or the right brand, is not checked here.'
      : 'The declared next step did not pass the destination check, so it was withheld rather than passed on. Read action_withheld.say_this to the user.'
  };
}

// ---------- the withholding contract ----------
// On any check state other than a resolving, eligible target the action is NOT returned.
// Handing back a dead action with a status field attached is a flag, not a fix, because a
// model will surface it anyway.
//
// What this promises, stated precisely, because the looser version is wrong. This service does
// not return an action that failed its check at the moment of the check. It is a statement
// about what we hand back, at that time. It is NOT a guarantee that an agent can never surface
// a dead link, because the agent may hold the link from somewhere else, and a target that
// responded when checked can stop responding a second later.
//
// The refusal is information rather than an absence, so the reason below is written to be
// said out loud by the model, not logged. Wording is deliberate on two points. A 5xx or a
// timeout is "not working right now" or "could not be checked", never "the page does not
// exist", because a target that returned 502 once returned 200 on recheck. And the
// publisher's own homepage is withheld too, because it repeats the citation.
function spokenRefusal(a) {
  const label = a.label ? `"${a.label}"` : 'a next step';
  const v = a.verified || {};
  if (!VERIFY_ACTIONS) return `The publisher suggests ${label}, but destination checking is switched off, so it has not been passed on.`;
  if (v.status === 'resolves' && a.target_shape === 'publisher_root')
    return `The publisher suggests ${label}, but it only points back to their own homepage, which the citation above already gives you. It has not been passed on.`;
  if (v.status === 'dead')
    return `The publisher suggests ${label}, but that link is not working right now: it returns HTTP ${v.http_status}. It has not been passed on.`;
  if (v.status === 'unreachable')
    return `The publisher suggests ${label}, but it could not be checked from here, because ${v.reason}. That is not the same as it being broken. It has not been passed on.`;
  if (v.status === 'blocked')
    return `The publisher suggests ${label}, but it was not followed, because ${v.reason}. It has not been passed on.`;
  return `The publisher suggests ${label}, but it did not pass the destination check, so it has not been passed on.`;
}

// ---------- senso_probe: the model attacks the retriever, the checker keeps score ----------
// The division of labour here is the whole point, and it is the reverse of the usual one.
// GPT-6 Astra is the FUZZER: it writes natural rephrasings of the user's question, which is a
// judgement task a model is good at. The retriever and the deterministic comparison are the
// ORACLE: they decide, without a model anywhere in the loop, whether each rephrasing still
// lands on the same published page.
//
// So no verification moves into the model. The model generates the attack, it does not score
// it, and it cannot mark its own work.
//
// The key is read from the SERVER's environment. Callers still need no key and no account, so
// the keyless claim is unchanged for anyone using the tool.
const ASTRA_MODEL = process.env.ASTRA_MODEL || 'gpt-6-astra';
const ASTRA_KEY = process.env.OPENAI_API_KEY || '';
const PROBE_MAX_N = 5;

async function astraRephrase(question, n) {
  if (!ASTRA_KEY) return { error: 'no_model_key', detail: 'Set OPENAI_API_KEY in the server environment to run the probe.' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 45000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { authorization: `Bearer ${ASTRA_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ASTRA_MODEL,
        messages: [
          { role: 'system', content: 'You rewrite a question the way different real people would type it. Keep the information need identical. Do not add facts, brand names or jargon that are not in the original. Reply with JSON only: {"rephrasings":["...","..."]}' },
          { role: 'user', content: `Write ${n} natural rephrasings of this question. Return the requested JSON object.\n\nQuestion: ${question}` }
        ],
        response_format: { type: 'json_object' }
      })
    });
    const body = await r.json();
    if (!r.ok) return { error: 'model_http_error', detail: `HTTP ${r.status}: ${(body.error && body.error.message) || ''}`.slice(0, 200) };
    let parsed;
    try { parsed = JSON.parse(body.choices?.[0]?.message?.content || ''); }
    catch { return { error: 'model_bad_json' }; }
    const list = Array.isArray(parsed.rephrasings) ? parsed.rephrasings.filter(x => typeof x === 'string' && x.trim()) : [];
    if (!list.length) return { error: 'model_returned_no_rephrasings' };
    // The model id is echoed from the API RESPONSE, never from what we configured. If the
    // response does not name an Astra model the tool says so rather than claiming one.
    const returned = body.model || null;
    return {
      rephrasings: list.slice(0, n),
      model: returned,
      model_is_astra: !!(returned && /astra/i.test(returned)),
      usage: body.usage || null
    };
  } catch (e) {
    return { error: 'model_unreachable', detail: e.name === 'AbortError' ? 'no response within 45s' : e.message };
  } finally { clearTimeout(timer); }
}

async function probe(question, n) {
  n = Math.max(1, Math.min(PROBE_MAX_N, Number(n) || 3));
  const base = await answer(question, 40);
  if (base.match !== 'ok') {
    return { question, error: 'baseline_no_match', note: 'The original question does not retrieve a page, so there is nothing to test rephrasings against.', baseline: base };
  }
  const baselineUrl = base.source.url;
  const gen = await astraRephrase(question, n);
  if (gen.error) return { question, baseline_url: baselineUrl, error: gen.error, detail: gen.detail };

  const results = [];
  for (const q of gen.rephrasings) {
    const a = await answer(q, 40);
    const url = a.match === 'ok' ? a.source.url : null;
    results.push({
      rephrasing: q,
      match: a.match,
      score: a.score ?? a.best_score ?? null,
      returned_url: url,
      verdict: a.match !== 'ok' ? 'no_match' : (url === baselineUrl ? 'same_page' : 'wrong_page')
    });
  }
  const count = v => results.filter(r => r.verdict === v).length;
  const wrong = count('wrong_page');
  return {
    question,
    baseline_url: baselineUrl,
    model: gen.model,
    model_is_astra: gen.model_is_astra,
    usage: gen.usage,
    relevance_floor: MIN_SCORE,
    tested: results.length,
    counts: { same_page: count('same_page'), wrong_page: wrong, no_match: count('no_match') },
    results,
    // Three buckets, never two. A wrong page is worse than a miss, because a miss is visibly a
    // miss and a confident wrong page is not. Averaging them into one accuracy figure hides
    // exactly the failure that matters.
    reading: `${count('same_page')} of ${results.length} rephrasings still found the original page. ${wrong} returned a DIFFERENT page, which is the worst outcome because it is confidently wrong. ${count('no_match')} returned nothing, which is the safe failure.`,
    what_this_is_not: 'A live measurement on one question, not a benchmark. Retrieval here is lexical, so this number is expected to be poor and that is the finding rather than a defect being hidden.'
  };
}

// ---------- MCP over stdio, JSON-RPC 2.0, newline delimited ----------
const TOOLS = [
  {
    name: 'senso_verified_answer',
    description: 'Answer a question from Senso\'s public published network and return the answer, its source URL for citation, and any embedded brand call to action found in the page schema.org data. No API key required.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to answer.' },
        max_words: { type: 'number', description: 'Max words of answer text. Default 220.' }
      },
      required: ['question']
    }
  },
  {
    name: 'senso_probe',
    description: 'Stress test the retriever on your own question. GPT-6 Astra writes natural rephrasings of the question, each one is run through the same retrieval path, and a deterministic comparison reports how many still find the original page, how many return a DIFFERENT page, and how many return nothing. Use this to see where the retrieval actually fails.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to stress test.' },
        n: { type: 'number', description: 'How many rephrasings to generate, 1 to 5. Default 3.' }
      },
      required: ['question']
    }
  },
  {
    name: 'senso_list_sources',
    description: 'List the published pages available in Senso\'s public network, with titles and URLs.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Default 40.' } } }
  }
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, message) => send({ jsonrpc: '2.0', id, error: { code: -32000, message } });

async function handle(req) {
  const out = await dispatch(req);
  if (out) send(out);
}

// Returns the JSON-RPC response object, or null for a notification that takes no reply.
// Both transports call this, so stdio and streaming HTTP cannot drift apart.
async function dispatch(req) {
  const { id, method, params } = req;
  const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
  const err = (id, message) => ({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'senso-mcp', version: '0.1.0' }
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    try {
      let payload;
      if (name === 'senso_verified_answer') {
        if (!args.question) throw new Error('question is required');
        payload = await answer(args.question, args.max_words || 220);
      } else if (name === 'senso_probe') {
        if (!args.question) throw new Error('question is required');
        payload = await probe(args.question, args.n);
      } else if (name === 'senso_list_sources') {
        if (!INDEX || !INDEX.length) INDEX = await buildIndex();
        // buildIndex swallows per-domain fetch errors so one bad domain cannot kill the rest,
        // which means a total network failure arrived here as an authoritative empty list.
        if (!INDEX.length) throw new Error('No pages indexed. Check SENSO_DOMAINS and network.');
        payload = { count: INDEX.length, pages: INDEX.slice(0, args.limit || 40) };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) return err(id, `Unknown method: ${method}`);
  return null;
}

// ---------- optional HTTP mode: node senso-mcp.js --http [port] ----------
// Same payload as the MCP tool, over plain HTTP, so an agent that cannot speak stdio MCP
// can still fetch a published answer and its call to action. No key, no dependencies.
// ---------- MCP over streaming HTTP: node senso-mcp.js --mcp-http [port] ----------
// ChatGPT's Developer mode connects to a REMOTE MCP server and cannot speak stdio, so the
// stdio transport above is unreachable from it. This serves the same dispatch() over HTTP at
// /mcp with NO AUTHENTICATION, which is deliberate: anyone can paste the URL and use it with
// no Senso account and no key. That is the claim the whole project rests on.
//
// Stateless by design. No session id is issued and none is required, so a restart cannot
// strand a connected client, and two clients cannot interfere with each other.
const MCPHTTP_IDX = process.argv.indexOf('--mcp-http');

function startMcpHttp() {
  const http = require('http');
  const port = Number(process.argv[MCPHTTP_IDX + 1] || process.env.PORT || 8899);
  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'cache-control': 'no-store'
  };
  const json = (res, code, obj) => {
    res.writeHead(code, Object.assign({}, CORS, { 'content-type': 'application/json; charset=utf-8' }));
    res.end(obj === undefined ? '' : JSON.stringify(obj));
  };
  http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname === '/health') return json(res, 200, { ok: true, domains: DOMAINS, indexed: INDEX ? INDEX.length : 0 });
    if (url.pathname !== '/mcp') return json(res, 404, { error: 'The MCP endpoint is /mcp. POST JSON-RPC to it.' });
    // A GET on /mcp opens the optional server to client stream. Nothing here is server
    // initiated, so it is declined cleanly rather than left hanging open.
    if (req.method !== 'POST') return json(res, 405, { error: 'POST JSON-RPC to /mcp' });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); }
      catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
      const batch = Array.isArray(msg) ? msg : [msg];
      // One failing message must not take down the others, and a notification returns null,
      // which is filtered out rather than sent as an empty reply.
      const out = (await Promise.all(batch.map(m =>
        Promise.resolve().then(() => dispatch(m)).catch(e =>
          m && m.id !== undefined ? { jsonrpc: '2.0', id: m.id, error: { code: -32000, message: e.message } } : null)
      ))).filter(Boolean);
      if (!out.length) { res.writeHead(202, CORS); return res.end(); }
      const payload = Array.isArray(msg) ? out : out[0];
      // A client asking for a stream gets one SSE frame and a close. A client asking for JSON
      // gets JSON. Both are valid streamable HTTP responses, and ChatGPT sends the former.
      if (/text\/event-stream/.test(req.headers.accept || '')) {
        res.writeHead(200, Object.assign({}, CORS, { 'content-type': 'text/event-stream', 'connection': 'keep-alive' }));
        res.write('event: message\ndata: ' + JSON.stringify(payload) + '\n\n');
        return res.end();
      }
      json(res, 200, payload);
    });
  }).listen(port, () => {
    process.stderr.write(`senso-mcp streaming HTTP MCP listening on port ${port}, endpoint /mcp\n`);
  });
}

const HTTP_IDX = process.argv.indexOf('--http');
if (MCPHTTP_IDX !== -1) {
  startMcpHttp();
} else if (HTTP_IDX !== -1) {
  const http = require('http');
  const port = Number(process.argv[HTTP_IDX + 1] || process.env.PORT || 8787);
  http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, obj) => {
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'cache-control': 'no-store'
      });
      res.end(JSON.stringify(obj, null, 2));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    if (url.pathname === '/health') return send(200, { ok: true, domains: DOMAINS });
    if (url.pathname === '/cta' || url.pathname === '/answer') {
      const q = url.searchParams.get('q') || url.searchParams.get('question');
      if (!q) return send(400, { error: 'pass ?q=your+question' });
      const mw = Number(url.searchParams.get('max_words')) || 60;
      answer(q, mw).then(p => send(200, p)).catch(e => send(502, { error: e.message }));
      return;
    }
    send(404, { error: 'try /cta?q=your+question or /health' });
  }).listen(port, () => {
    process.stderr.write(`senso-mcp http listening: http://localhost:${port}/cta?q=what+problem+does+senso+solve\n`);
  });
} else {

let buf = '';
let pending = 0, stdinEnded = false;
function maybeExit() { if (stdinEnded && pending === 0) process.exit(0); }
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let req; try { req = JSON.parse(line); } catch { continue; }
    pending++;
    Promise.resolve(handle(req))
      .catch(e => { if (req.id !== undefined) err(req.id, e.message); })
      .finally(() => { pending--; maybeExit(); });
  }
});
// stdin closing must not kill work already in flight: a piped test harness closes the
// pipe immediately, and every network-backed tool call was being cut off mid-fetch.
process.stdin.on('end', () => { stdinEnded = true; maybeExit(); });

} // end stdio mode
