#!/usr/bin/env node
/**
 * astra.js — the presentation surface for the Senso published-action demo.
 *
 * WHAT THIS IS. One page that asks a question, retrieves a published answer and the next step
 * the publisher attached, and has a model explain the fit. It is deliberately thin: all the
 * retrieval work lives in senso-mcp.js, which is hash-verified and must not be edited to make
 * this run.
 *
 * WHY TWO ROUND TRIPS AND NOT ONE. The progress states have to be honest. "Finding a source"
 * is shown while retrieval is genuinely running, and "Preparing your answer" while the model
 * call is genuinely running. A single request with a client-side animation would be a fake
 * progress bar, which the design brief rules out. So the page calls /api/retrieve, renders what
 * came back, then calls /api/explain.
 *
 * WHERE THE KEYS ARE. The Senso side needs no key at all: retrieval is public HTTP against
 * published pages. The model side does need one, and it stays in this process. No key is ever
 * sent to the browser. Those two facts are different and the page says so rather than blurring
 * them into one "no key needed" claim.
 *
 * WHAT THIS DOES NOT CLAIM. A link that responds is a link that responds. It is not a verified
 * answer, not a safety judgement, and not completed onboarding. The status line says "Link
 * checked" with the time it was checked, and nothing stronger.
 */

const http = require('http');

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>From an answer to your next step</title>
<style>
  :root{--ink:#12161c;--mut:#5b6673;--line:#e2e6eb;--bg:#fbfcfd;--card:#fff;--brand:#0f8a6a;--warn:#8a5a0f;--bad:#a3352b}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:56px 24px 96px}
  h1{font-size:34px;line-height:1.2;margin:0 0 8px;letter-spacing:-.02em}
  .sub{color:var(--mut);margin:0 0 32px;font-size:16px}
  form{display:flex;gap:10px;margin-bottom:10px}
  input{flex:1;padding:15px 16px;font-size:17px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink)}
  input:focus{outline:2px solid var(--brand);outline-offset:-1px;border-color:var(--brand)}
  button{padding:15px 24px;font-size:17px;font-weight:600;border:0;border-radius:10px;background:var(--brand);color:#fff;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .hint{color:var(--mut);font-size:14px;margin:0 0 36px}
  .hint b{color:var(--ink);font-weight:600}
  .phase{display:flex;align-items:center;gap:10px;color:var(--mut);font-size:15px;padding:14px 0}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--brand);animation:p 1s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:.25}50%{opacity:1}}
  .answer{font-size:19px;line-height:1.6;margin:0 0 6px}
  .lbl{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:0 0 8px}
  .src{font-size:15px;margin:14px 0 0}
  .src a{color:var(--brand)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;margin:28px 0 0}
  .who{font-size:13px;color:var(--mut);margin:0 0 10px}
  .fit{font-size:15px;color:var(--mut);margin:0 0 18px}
  .cta{display:inline-block;padding:14px 26px;background:var(--ink);color:#fff;text-decoration:none;border-radius:10px;font-weight:600}
  .chk{font-size:13px;color:var(--mut);margin:16px 0 0}
  .chk.bad{color:var(--bad)}.chk.warn{color:var(--warn)}
  .none{background:#fff;border:1px dashed var(--line);border-radius:14px;padding:24px;margin:28px 0 0}
  .none h3{margin:0 0 8px;font-size:17px}
  .none p{margin:0;color:var(--mut);font-size:15px}
  details{margin:30px 0 0;border-top:1px solid var(--line);padding-top:16px}
  summary{cursor:pointer;color:var(--mut);font-size:14px}
  pre{background:#f4f6f8;border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12.5px;line-height:1.5;margin:14px 0 0}
  .err{background:#fdf3f2;border:1px solid #f0cdc9;color:var(--bad);border-radius:10px;padding:16px;margin:24px 0 0;font-size:15px}
  .foot{margin:44px 0 0;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
</style></head><body><div class="wrap">
<h1>From an answer to your next step</h1>
<p class="sub">Ask a question. Get a published answer, its source, and the next step the publisher attached to it.</p>
<form id="f"><input id="q" value="__EXAMPLE__" autocomplete="off"><button id="go" type="submit">Ask</button></form>
<p class="hint">Retrieval uses <b>no API key and no account</b>. It reads the published page over ordinary HTTP. The explanation below it is written by a model, which does authenticate.</p>
<div id="out"></div>
<div class="foot" id="foot"></div>
</div><script>
const $=s=>document.querySelector(s), out=$('#out');
let cfg={};
fetch('/api/config').then(r=>r.json()).then(c=>{cfg=c;
  $('#foot').textContent='Model: '+c.model+(c.model_key_present?'':'  (no key set)')+'  ·  Consumer: '+c.cta_base;});
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const phase=t=>{out.innerHTML='<div class="phase"><span class="dot"></span>'+esc(t)+'</div>';};

function checkLine(a,when){
  const v=a.verified||{};
  if(v.status==='resolves') return '<p class="chk">Link checked '+esc(new Date(when).toLocaleTimeString())+' · responded '+esc(v.http_status)+'</p>';
  if(v.status==='dead') return '<p class="chk bad">Link checked '+esc(new Date(when).toLocaleTimeString())+' · did not resolve ('+esc(v.http_status)+'). Not shown as usable.</p>';
  if(v.status==='unreachable') return '<p class="chk warn">Link could not be checked from here. Unknown, not broken.</p>';
  return '<p class="chk warn">Link not checked.</p>';
}

$('#f').addEventListener('submit',async e=>{
  e.preventDefault();
  const question=$('#q').value.trim(); if(!question) return;
  $('#go').disabled=true;
  try{
    phase('Finding a source');
    const r=await fetch('/api/retrieve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question})});
    const p=await r.json();
    if(p.error){out.innerHTML='<div class="err"><b>Retrieval failed.</b> '+esc(p.detail||p.error)+'</div>';return;}

    if(p.match!=='ok'){
      out.innerHTML='<div class="none"><h3>No confident match in the published network.</h3>'+
        '<p>Nothing was fetched and no next step is offered. Best candidate scored '+esc(p.best_score)+', below the floor of '+esc(p.min_score)+'.</p></div>'+
        '<details><summary>How this was sourced</summary><pre>'+esc(JSON.stringify(p,null,1))+'</pre></details>';
      return;
    }

    const a=p.action, when=p.checked_at;
    let html='<p class="lbl">Answer, in the publisher\\'s own words</p><p class="answer">'+esc(p.answer)+'</p>'+
      '<p class="src">Source: <a href="'+esc(p.source.url)+'" target="_blank" rel="noopener">'+esc(p.source.url)+'</a></p>';
    if(a && a.usable){
      html+='<div class="card"><p class="who">'+esc(p.source.publisher)+' attached this next step</p>'+
        '<p class="fit" id="fit">Checking how well it fits your question…</p>'+
        '<a class="cta" href="'+esc(a.target)+'" target="_blank" rel="noopener">'+esc(a.label)+'</a>'+
        checkLine(a,when)+'</div>';
    } else if(a){
      html+='<div class="none"><h3>The publisher attached a next step, but it is not usable.</h3><p>'+esc(p.action_note||'')+'</p></div>';
    } else {
      html+='<div class="none"><h3>This page attaches no next step.</h3><p>None was invented.</p></div>';
    }
    html+='<details><summary>How this was sourced</summary><pre id="trace">'+esc(JSON.stringify(p,null,1))+'</pre></details>';
    out.innerHTML=html;

    if(a && a.usable){
      const fit=$('#fit'); fit.textContent='Preparing your answer…';
      const r2=await fetch('/api/explain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question,payload:p})});
      const m=await r2.json();
      if(m.error){ fit.innerHTML='<span style="color:var(--warn)">Explanation unavailable ('+esc(m.error)+'). The retrieved answer and next step above are unaffected.</span>'; }
      else{
        const tag=m.fit==='good'?'':' <b>Fit is '+esc(m.fit)+':</b> '+esc(m.fit_reason);
        fit.innerHTML='<b>Explanation (written by '+esc(m.model)+', not by the publisher):</b> '+esc(m.explanation)+tag;
        const t=$('#trace'); if(t) t.textContent+='\\n\\nmodel: '+JSON.stringify({model:m.model,fit:m.fit,ms:m.model_ms},null,1);
      }
    }
  }catch(err){ out.innerHTML='<div class="err"><b>Request failed.</b> '+esc(err.message)+'</div>'; }
  finally{ $('#go').disabled=false; }
});
</script></body></html>`;


const PORT       = Number(process.env.ASTRA_PORT || 8800);
const CTA_BASE   = process.env.CTA_BASE || 'http://localhost:8899';
const MODEL      = process.env.ASTRA_MODEL || 'gpt-5.4-mini';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const EXAMPLE_Q  = 'What makes documentation readable by AI agents?';

const j = (res, code, obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length });
  res.end(b);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---------- retrieval: straight through to the keyless consumer ----------
async function retrieve(question) {
  // 220 words, not the endpoint's 60-word default. At 60 the answer is cut off mid-setup, and
  // the model then correctly reports that the article does not contain what it in fact contains.
  // The truncation was the bug, not the model.
  const u = `${CTA_BASE}/cta?q=${encodeURIComponent(question)}&max_words=220`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 180000);
  try {
    const r = await fetch(u, { signal: ac.signal });
    if (!r.ok) throw new Error(`consumer returned HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------- the model layer ----------
// The model is given the publisher's own words and is told to stay inside them. It writes an
// explanation, which the page labels as an explanation. It never speaks as the publisher, and
// it judges whether the attached next step actually fits the question rather than assuming it.
const SYSTEM = `You explain published sources to someone who asked a question.

Rules, all of them hard:
- Use ONLY the publisher text provided. If it does not answer the question, say what it does and
  does not cover. Never add facts from your own knowledge.
- Two or three sentences. Plain language. No preamble, no "based on the provided text".
- You are writing an explanation, not speaking as the publisher. Do not use their voice.
- Separately, judge whether the publisher's attached next step is a sensible follow-up for THIS
  question. It is a publisher-offered next step, not a guaranteed answer to the question. If the
  fit is loose, say so plainly in one short clause.

Return strict JSON, no code fence:
{"explanation": "...", "fit": "good" | "loose" | "poor", "fit_reason": "one short clause"}`;

async function explain(question, payload) {
  if (!OPENAI_KEY) return { error: 'no_model_key', detail: 'OPENAI_API_KEY is not set in the server environment.' };
  const src = payload.source || {};
  const act = payload.action || null;
  const user = [
    `Question: ${question}`,
    `Publisher: ${src.publisher || 'unknown'}`,
    `Source URL: ${src.url || 'unknown'}`,
    `Publisher text:\n${payload.answer || '(none)'}`,
    act ? `Publisher's attached next step: "${act.label}" pointing at ${act.target}` : 'Publisher attached no next step.'
  ].join('\n\n');

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'authorization': `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
        response_format: { type: 'json_object' }
      })
    });
    const body = await r.json();
    if (!r.ok) return { error: 'model_http_error', detail: `HTTP ${r.status}: ${(body.error && body.error.message) || ''}`.slice(0, 300) };
    const txt = body.choices?.[0]?.message?.content || '';
    let parsed; try { parsed = JSON.parse(txt); } catch { return { error: 'model_bad_json', detail: txt.slice(0, 200) }; }
    return { ...parsed, model: body.model || MODEL, usage: body.usage || null };
  } catch (e) {
    return { error: 'model_unreachable', detail: e.name === 'AbortError' ? 'no response within 60s' : String(e.message).slice(0, 200) };
  } finally { clearTimeout(t); }
}

// ---------- server ----------
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const b = Buffer.from(PAGE.replace('__EXAMPLE__', EXAMPLE_Q));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': b.length });
    return res.end(b);
  }

  if (url.pathname === '/api/config') {
    return j(res, 200, { model: MODEL, model_key_present: !!OPENAI_KEY, cta_base: CTA_BASE, example: EXAMPLE_Q });
  }

  if (url.pathname === '/api/retrieve' && req.method === 'POST') {
    try {
      const { question } = await readBody(req);
      if (!question || !question.trim()) return j(res, 400, { error: 'question is required' });
      const started = Date.now();
      const payload = await retrieve(question.trim());
      return j(res, 200, { ...payload, retrieval_ms: Date.now() - started, checked_at: new Date().toISOString() });
    } catch (e) {
      return j(res, 502, { error: 'retrieval_failed', detail: String(e.message).slice(0, 300) });
    }
  }

  if (url.pathname === '/api/explain' && req.method === 'POST') {
    try {
      const { question, payload } = await readBody(req);
      if (!question || !payload) return j(res, 400, { error: 'question and payload are required' });
      const started = Date.now();
      const out = await explain(question, payload);
      return j(res, 200, { ...out, model_ms: Date.now() - started });
    } catch (e) {
      return j(res, 502, { error: 'explain_failed', detail: String(e.message).slice(0, 300) });
    }
  }

  j(res, 404, { error: 'not found' });
}).listen(PORT, () => {
  process.stderr.write(`astra listening on http://localhost:${PORT}\n`);
  process.stderr.write(`  consumer: ${CTA_BASE}\n  model:    ${MODEL}${OPENAI_KEY ? '' : '  (NO KEY SET)'}\n`);
});
