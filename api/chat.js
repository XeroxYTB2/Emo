const SYS = “Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO. Tu parles TOUJOURS en français, tu tutoies toujours, tu fais 1-3 phrases max. L’utilisateur habite en France (fuseau Europe/Paris). RÈGLES : (1) Tu reçois parfois des images de la caméra — décris UNIQUEMENT ce que tu vois vraiment, n’invente rien, si c’est flou dis-le. (2) Quand des résultats web sont fournis entre [WEB] et [/WEB], utilise-les pour répondre avec précision.”;

function needsSearch(q) {
return /heure|météo|meteo|temps qu|pluie|soleil|neige|actualité|news|aujourd.hui|maintenant|prix|résultat|score|match|élection|mort|décès|récent|2025|2026/.test(q.toLowerCase());
}

async function webSearch(query, serperKey) {
try {
const k = serperKey || process.env.SERPER_KEY;
if (!k) return null;
const r = await fetch(‘https://google.serper.dev/search’, {
method: ‘POST’,
headers: { ‘X-API-KEY’: k, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ q: query + ’ France’, gl: ‘fr’, hl: ‘fr’, num: 4 })
});
if (!r.ok) return null;
const d = await r.json();
const parts = [];
if (d.answerBox && d.answerBox.answer) parts.push(d.answerBox.answer);
if (d.answerBox && d.answerBox.snippet) parts.push(d.answerBox.snippet);
if (d.knowledgeGraph && d.knowledgeGraph.description) parts.push(d.knowledgeGraph.description);
(d.organic || []).slice(0, 3).forEach(function(o) {
if (o.snippet) parts.push(o.title + ‘: ’ + o.snippet);
});
return parts.length ? parts.join(’\n’) : null;
} catch(e) { return null; }
}

// Lit le body depuis le stream HTTP (Vercel Node.js sans framework)
function readBody(req) {
return new Promise(function(resolve, reject) {
// Si déjà parsé par Vercel
if (req.body && typeof req.body === ‘object’) {
resolve(req.body);
return;
}
var chunks = [];
req.on(‘data’, function(chunk) { chunks.push(chunk); });
req.on(‘end’, function() {
try {
var raw = Buffer.concat(chunks).toString(‘utf8’);
resolve(raw ? JSON.parse(raw) : {});
} catch(e) { resolve({}); }
});
req.on(‘error’, function(e) { reject(e); });
});
}

module.exports = async function(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) { res.status(204).end(); return; }
if (req.method !== ‘POST’) { res.status(405).json({ error: ‘Method not allowed’ }); return; }

var body;
try { body = await readBody(req); }
catch(e) { res.status(400).json({ error: ‘Bad request’ }); return; }

var provider  = body.provider  || ‘’;
var messages  = body.messages  || [];
var images    = (body.images   || []).filter(Boolean);
var serperKey = body.serperKey || ‘’;
var query     = body.query     || ‘’;
var hasImages = images.length > 0;
var prevMsgs  = messages.slice(0, -1);
var lastContent = messages.length > 0 ? (messages[messages.length - 1].content || ‘’) : ‘’;

var now = new Date().toLocaleString(‘fr-FR’, { timeZone: ‘Europe/Paris’, dateStyle: ‘full’, timeStyle: ‘short’ });
var sysWithDate = SYS + ’ Date et heure en France : ’ + now + ‘.’;

var webContext = null;
if (query && needsSearch(query)) {
webContext = await webSearch(query, serperKey);
}
var enriched = lastContent + (webContext ? ‘\n\n[WEB]\n’ + webContext + ‘\n[/WEB]’ : ‘’);

function fail(msg, code) { res.status(code || 400).json({ error: msg }); }

try {
var answer;

```
if (provider === 'gemini') {
  var gKey = process.env.GEMINI_KEY;
  if (!gKey) { fail('GEMINI_KEY manquante'); return; }
  var gc = [
    { role: 'user',  parts: [{ text: sysWithDate }] },
    { role: 'model', parts: [{ text: 'Compris !' }] }
  ];
  prevMsgs.forEach(function(m) {
    gc.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  });
  var lastParts = [];
  images.forEach(function(img) { lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: img } }); });
  lastParts.push({ text: enriched });
  gc.push({ role: 'user', parts: lastParts });

  var r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + gKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 300, temperature: 0.8 } })
  });
  var d = await r.json();
  if (!r.ok) { fail('Gemini: ' + (d.error ? d.error.message : r.status)); return; }
  answer = d.candidates[0].content.parts[0].text.trim();

} else if (provider === 'groq') {
  var gKey = process.env.GROQ_KEY;
  if (!gKey) { fail('GROQ_KEY manquante'); return; }
  var msgs = [{ role: 'system', content: sysWithDate }];
  prevMsgs.forEach(function(m) { msgs.push({ role: m.role, content: m.content }); });
  msgs.push({ role: 'user', content: enriched });
  var r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gKey },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 300, temperature: 0.8, messages: msgs })
  });
  var d = await r.json();
  if (!r.ok) { fail('Groq: ' + (d.error ? d.error.message : r.status)); return; }
  answer = d.choices[0].message.content.trim();

} else if (provider === 'anthropic') {
  var aKey = process.env.ANTHROPIC_KEY;
  if (!aKey) { fail('ANTHROPIC_KEY manquante'); return; }
  var antMsgs = [];
  prevMsgs.forEach(function(m) {
    antMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  });
  if (hasImages) {
    var content = [];
    images.forEach(function(img) { content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }); });
    content.push({ type: 'text', text: enriched });
    antMsgs.push({ role: 'user', content: content });
  } else {
    antMsgs.push({ role: 'user', content: enriched });
  }
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: sysWithDate, messages: antMsgs })
  });
  var d = await r.json();
  if (!r.ok) { fail('Anthropic: ' + (d.error ? d.error.message : r.status)); return; }
  answer = d.content[0].text.trim();

} else if (provider === 'openai') {
  var oKey = process.env.OPENAI_KEY;
  if (!oKey) { fail('OPENAI_KEY manquante'); return; }
  var oMsgs = [{ role: 'system', content: sysWithDate }];
  prevMsgs.forEach(function(m) { oMsgs.push({ role: m.role, content: m.content }); });
  if (hasImages) {
    var content = [];
    images.forEach(function(img) { content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } }); });
    content.push({ type: 'text', text: enriched });
    oMsgs.push({ role: 'user', content: content });
  } else {
    oMsgs.push({ role: 'user', content: enriched });
  }
  var r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + oKey },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.8, messages: oMsgs })
  });
  var d = await r.json();
  if (!r.ok) { fail('OpenAI: ' + (d.error ? d.error.message : r.status)); return; }
  answer = d.choices[0].message.content.trim();

} else {
  fail('Provider inconnu: ' + provider); return;
}

res.status(200).json({ answer: answer });
```

} catch(e) {
fail(’Erreur serveur: ’ + e.message, 500);
}
};