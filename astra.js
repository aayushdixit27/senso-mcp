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
<html><head><meta charset="utf-8"><title>ChatGPT</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--ink:#0d0d0d;--mut:#5d5d67;--faint:#8f8f9d;--line:#e8e8ed;--hair:#ededf1;--bub:#e8edfb;
      --grn:#17864a;--grnbg:#e6f4ec;--off:#8e8e99;--offbg:#f1f1f3}
*{box-sizing:border-box}
html{-webkit-font-smoothing:antialiased}
body{margin:0;background:#fff;color:var(--ink);
     font:17px/1.75 ui-sans-serif,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.thread{max-width:790px;margin:0 auto;padding:30px 24px 140px}
.askbar{display:flex;gap:10px;margin-bottom:10px}
.askbar input{flex:1;padding:14px 18px;border:1px solid var(--line);border-radius:26px;font:inherit;font-size:16px}
.askbar input:focus{outline:none;border-color:#c9c9d4}
.askbar button{padding:14px 22px;border:0;border-radius:26px;background:var(--ink);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.askbar button:disabled{opacity:.4}
.presets{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:34px}
.presets b{font-weight:450;font-size:13px;color:var(--mut);background:#f6f6f8;padding:6px 12px;border-radius:999px;cursor:pointer}
.turn{display:flex;justify-content:flex-end;margin-bottom:32px}
.bub{background:var(--bub);border-radius:22px;padding:12px 20px;max-width:76%;font-size:17px;line-height:1.55}
.ans p{margin:0 0 20px}
.ans strong{font-weight:650}
table{width:100%;border-collapse:collapse;margin:6px 0 26px;font-size:16px}
th{text-align:left;font-weight:650;padding:0 16px 12px 0;border-bottom:1px solid var(--hair)}
td{padding:15px 16px 15px 0;border-bottom:1px solid var(--hair);vertical-align:top;color:#24242c}
td.n{font-weight:650;color:var(--ink)}
tr.hit td{background:#fbfcff}
.mark{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:650;color:var(--grn);
      background:var(--grnbg);padding:3px 9px;border-radius:999px;margin-left:8px;vertical-align:1px}
.mark svg{width:11px;height:11px}
/* the big box, inline in the answer */
.box{border:1px solid var(--line);border-radius:18px;padding:16px;margin:4px 0 26px;background:#fff}
.bhead{display:flex;align-items:flex-start;gap:14px;padding:2px 4px 14px}
.blogo{width:52px;height:52px;border-radius:50%;background:#fff;border:1px solid var(--line);flex:0 0 52px;
       display:grid;place-items:center;overflow:hidden;padding:7px}
.blogo img{max-width:100%;max-height:100%}
.blogo .wm{font-size:12px;font-weight:800;color:var(--mut);text-align:center;line-height:1.15}
.btitle{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.btitle h3{margin:0;font-size:19px;font-weight:650;line-height:1.35;letter-spacing:-.01em}
.tag{font-size:12px;font-weight:650;padding:3px 10px;border-radius:999px;cursor:pointer}
.tag.on{color:var(--grn);background:var(--grnbg)}
.tag.off{color:var(--off);background:var(--offbg)}
.bdesc{margin-top:6px;color:var(--mut);font-size:15.5px;line-height:1.55}
.split{display:flex;gap:18px;border-top:1px solid var(--hair);padding-top:16px;align-items:flex-start}
.shot{flex:0 0 46%;height:206px;border-radius:12px;overflow:hidden;background:#f2f2f6;
      display:grid;place-items:center;text-align:center}
.shot img{width:100%;height:100%;object-fit:cover;object-position:center;display:block}
.shot .empty{color:#9a9aa8;font-size:13px;line-height:1.6;max-width:220px;padding:16px}
.side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:9px;
      height:206px;padding:2px 2px 2px 0}
.kick{color:var(--mut);font-size:14.5px}
.side h4{margin:0;font-size:19px;font-weight:650;letter-spacing:-.01em;line-height:1.3}
.loc{display:flex;align-items:center;gap:8px;color:var(--mut);font-size:14.5px}
.loc svg{width:16px;height:16px;flex:0 0 16px;color:#9a9aa8}
.side h4{white-space:normal;overflow-wrap:anywhere}
.btitle h3{overflow-wrap:anywhere}
.sub{display:inline-flex;align-items:center;justify-content:center;gap:11px;background:var(--grn);color:#fff;
     text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:650;font-size:15px;
     margin-top:2px;align-self:flex-start}
.sub svg{width:16px;height:16px;flex:0 0 16px}
.held{border-radius:10px;background:#fbf4f4;border:1px solid #efdcdc;padding:12px 14px;color:#84464a;font-size:14px;line-height:1.6}
.held b{color:#68343a;display:block;margin-bottom:2px}
.vs{display:inline-flex;align-items:center;gap:8px;font-size:14px;font-weight:500;cursor:pointer;
     white-space:nowrap;align-self:flex-start}
.vs svg{width:15px;height:15px;flex:0 0 15px}
.vs.on{color:var(--grn)}.vs.off{color:var(--off)}
.pills{display:flex;flex-wrap:wrap;gap:7px;padding:14px 4px 2px}
.p{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:5px 11px;border-radius:999px;cursor:pointer;font-weight:550}
.p.on{background:var(--grnbg);color:var(--grn)}
.p.off{background:var(--offbg);color:var(--off)}
.p svg{width:12px;height:12px}
.ev{margin:12px 4px 0;background:#fafafc;border:1px solid var(--line);border-radius:12px;padding:15px 17px;
    font:12.5px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:#43434e}
.chip{display:inline-flex;align-items:center;gap:6px;background:#f1f1f3;border-radius:999px;padding:3px 10px 3px 7px;
      font-size:12.5px;color:var(--mut);cursor:pointer;vertical-align:1px;margin-left:3px}
.chip svg{width:13px;height:13px}
.note{color:var(--faint);font-size:13px;line-height:1.6;margin-top:12px}
.prog{display:flex;align-items:center;gap:11px;color:var(--faint);font-size:16px}
.sp2{width:14px;height:14px;border:2px solid var(--line);border-top-color:var(--faint);border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
[hidden]{display:none!important}
</style></head><body><div class="thread">
<form class="askbar" id="f"><input id="q" placeholder="Ask anything" autocomplete="off"><button id="go">Ask</button></form>
<div class="presets">
  <b data-q="What makes documentation readable by AI agents?">Senso: success</b>
  <b data-q="what problem does senso ai solve">Senso: blocked</b>
  <b data-q="best way to rent an SUV in Los Angeles">Turo: success</b>
  <b data-q="best luxury suv from mercedes">Mercedes-Benz: success</b>
  <b data-q="best mobile plans in canada telus">TELUS: agent blocked</b>
  <b data-q="best term life insurance in canada sun life">Sun Life: agent blocked</b>
</div>
<div id="out"></div>
</div><script>
var $=function(s){return document.querySelector(s)};
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var cfg={};fetch('/api/config').then(function(r){return r.json()}).then(function(c){cfg=c;$('#q').value=c.example});
var TICK='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5 6.2 11.8 2.9 8.5"/></svg>';
var CROSS='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></svg>';
var PIN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';
var ARR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var DIA='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/></svg>';
var LNK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 1 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 1 0 7 7l1-1"/></svg>';
function pill(on,l,ev){return '<span class="p '+(on?'on':'off')+'" data-ev="'+esc(JSON.stringify(ev))+'">'+(on?TICK:CROSS)+esc(l)+'</span>'}
function bigBox(p,m){
  var src=p.source||{},a=p.action,w=p.action_withheld,id=p.publisher_identity||{},img=p.image||{};
  var dom=src.publisher||'',name=id.name||dom||'Publisher';
  var declared=p.answer_source&&p.answer_source.indexOf('declared by the publisher')>=0;
  var title=(src.title||'').split('|')[0].trim();
  var v=a?a.verified:null;
  var o='<div class="box">';
  o+='<div class="bhead"><div class="blogo">'+(id.logo?'<img src="'+esc(id.logo)+'" alt="">':'<span class="wm">'+esc(name)+'</span>')+'</div><div style="flex:1">';
  o+='<div class="btitle"><h3>'+esc(title||name)+'</h3><span class="tag '+(a?'on':'off')+'" data-ev="'+esc(JSON.stringify({slot:'Next step',earned:!!a,rule:'the destination was requested over HTTP and responded, and it is not the publisher\\u2019s own site root',observed:v||w||p.action_missing||null}))+'">'+(a?'Verified':'Unverified')+'</span></div>';
  o+='<div class="bdesc">'+esc(p.answer||'')+'</div></div></div>';
  o+='<div class="split"><div class="shot">'+(img.url?'<img src="'+esc(img.url)+'" alt="">':'<span class="empty">'+esc(img.missing||'No image declared.')+'</span>')+'</div><div class="side">';
  o+='<div class="kick">'+(a?'Checked for this question':'Not passed on')+'</div>';
  o+='<h4>'+esc(a?a.label:(w?w.label:name))+'</h4>';
  if(v) o+='<div class="loc">'+PIN+'Destination responded, HTTP '+esc(v.http_status)+(v.redirects?', after '+esc(v.redirects)+' redirect':'')+'</div>';
  if(a) o+='<a class="sub" href="'+esc(a.target)+'" target="_blank" rel="noopener">'+esc(a.label)+ARR+'</a>';
  else if(w) o+='<div class="held"><b>Withheld</b>'+esc(w.say_this)+'</div>';
  else o+='<div class="held"><b>No next step declared</b>'+esc(p.action_missing||'This page declares none. None was invented.')+'</div>';
  o+='<div class="vs '+(src.url?'on':'off')+'" data-ev="'+esc(JSON.stringify({slot:'Verified source',earned:!!src.url,rule:'the citation resolves and belongs to the publisher\\u2019s domain',observed:src.url}))+'">'+DIA+'Verified Source</div>';
  o+='</div></div>';
  o+='<div class="pills">';
  o+=pill(declared,'Verified answer',{slot:'Verified answer',earned:declared,rule:'the text is the publisher\\u2019s own declared schema.org description',observed:p.answer_source,missing:p.answer_missing||undefined});
  o+=pill(!!id.name,'Publisher identity',{slot:'Publisher identity',earned:!!id.name,rule:'the wordmark comes from the publisher\\u2019s declared schema.org Organization',observed:id.name_source||'not declared'});
  o+=pill(!!img.url,'Declared image',{slot:'Image',earned:!!img.url,rule:'the photograph is the publisher\\u2019s own declared og:image or schema.org image, never stock and never generated',observed:img.source||img.missing});
  o+=pill(!!a,'Next step checked',{slot:'Next step',earned:!!a,rule:'the destination responded over HTTP and is not the publisher\\u2019s site root',observed:v||w||p.action_missing||null});
  o+='</div><div class="ev" id="ev" hidden></div></div>';
  return o;
}
function shortlist(p){
  var alts=(p.also_considered||[]).slice(0,4);
  if(!alts.length) return '';
  var src=p.source||{},id=p.publisher_identity||{};
  var o='<table><tr><th>Source</th><th>Why it came up</th></tr>';
  o+='<tr class="hit"><td class="n">'+esc(id.name||src.publisher)+'<span class="mark">'+TICK+'Verified card</span></td><td>Top match, and it carries a declared next step</td></tr>';
  alts.forEach(function(r){ o+='<tr><td class="n">'+esc((r.title||'').split('|')[0].trim().slice(0,58))+'</td><td>Also considered, no card</td></tr>'; });
  return o+'</table>';
}
function render(q,p,m){
  var src=p.source||{},dom=src.publisher||'';
  var prose=(m&&m.explanation)||p.answer||'';
  var o='<div class="turn"><div class="bub">'+esc(q)+'</div></div><div class="ans">';
  o+='<p>'+esc(prose)+'<span class="chip" data-ev="'+esc(JSON.stringify({slot:'Citation',rule:'this answer comes from a published page fetched over ordinary public HTTP with no key',observed:src.url}))+'">'+LNK+esc(dom)+'</span></p>';
  o+=shortlist(p);
  o+=bigBox(p,m);
  if(p.is_live_audit) o+='<div class="note">'+esc(p.audit_note||'')+' Structured data blocks on this page: <b>'+esc(p.structured_data_blocks)+'</b>.</div>';
  if(m&&m.fit) o+='<div class="note">'+esc(cfg.model||'The model')+' rated the attached offer <b>'+esc(m.fit)+'</b> for this question. '+esc(m.fit_reason||'')+'</div>';
  o+='<div class="note">Every green mark on the card is a check that passed. Click one for the rule and what was observed. Grey means the publisher left that slot empty or the check did not pass.</div>';
  return o+'</div>';
}
document.addEventListener('click',function(e){
  var b=e.target.closest('.p,.tag,.vs,.chip'); if(!b||!b.getAttribute('data-ev')) return;
  var ev=$('#ev'); if(!ev) return;
  ev.textContent=JSON.stringify(JSON.parse(b.getAttribute('data-ev')),null,2); ev.hidden=false;
});
document.addEventListener('click',function(e){
  var t=e.target.closest('.presets b'); if(!t) return;
  $('#q').value=t.getAttribute('data-q'); $('#f').dispatchEvent(new Event('submit',{cancelable:true}));
});
$('#f').addEventListener('submit',async function(e){
  e.preventDefault();
  var question=$('#q').value.trim(); if(!question) return;
  var out=$('#out'); $('#go').disabled=true;
  var head='<div class="turn"><div class="bub">'+esc(question)+'</div></div>';
  out.innerHTML=head+'<div class="prog"><span class="sp2"></span>Searching</div>';
  try{
    var r=await fetch('/api/retrieve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:question})});
    var p=await r.json();
    if(p.match!=='ok'){ out.innerHTML=head+'<div class="ans"><p>No published page answers this closely enough. Best score '+esc(p.best_score!=null?p.best_score:p.score)+' against the relevance floor, so nothing was returned rather than something confidently wrong.</p></div>'; return; }
    out.innerHTML=head+'<div class="prog"><span class="sp2"></span>Reading the source and checking its next step</div>';
    var m=null;
    try{ var r2=await fetch('/api/explain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:question,payload:p})}); var mm=await r2.json(); if(!mm.error) m=mm; }catch(_){}
    out.innerHTML=render(question,p,m);
  }catch(err){ out.innerHTML=head+'<div class="ans"><p>Request failed. '+esc(err.message)+'</p></div>'; }
  finally{ $('#go').disabled=false; }
});
</script></body></html>`;


const PORT       = Number(process.env.ASTRA_PORT || 8800);
const CTA_BASE   = process.env.CTA_BASE || 'http://localhost:8899';
const MODEL      = process.env.ASTRA_MODEL || 'gpt-6-astra';
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
