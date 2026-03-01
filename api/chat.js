const CORS = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
};

const SYS = “Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO. Tu parles TOUJOURS en français, tu tutoies toujours, tu fais 1-3 phrases max. L’utilisateur habite en France (fuseau Europe/Paris). RÈGLES : (1) Tu reçois parfois des images de la caméra — décris UNIQUEMENT ce que tu vois vraiment, n’invente rien, si c’est flou dis-le. (2) Quand des résultats web sont fournis entre [WEB] et [/WEB], utilise-les pour répondre avec précision. (3) Pour l’heure, la météo, l’actualité : la réponse est dans le contexte web fourni.”;

function needsSearch(q) {
return /heure|temps|météo|meteo|tempér|chaud|froid|pluie|soleil|neige|vent|actualité|news|aujourd.hui|maintenant|prix|résultat|score|match|élection|président|mort|décès|sorti|nouveau|récent|2024|2025|2026/.test(q.toLowerCase());
}

async function webSearch(query, serperKey) {
try {
const k = serperKey || process.env.SERPER_KEY;
if (!k) return null;
const r = await fetch(‘https://google.serper.dev/search’, {
method: ‘POST’,
headers: { ‘X-API-KEY’: k, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ q: query + ’ France’, gl: ‘fr’, hl: ‘fr’, num: 5 })
});
if (!r.ok) return null;
const d = await r.json();
const parts = [];
if (d.answerBox && d.answerBox.answer) parts.push(d.answerBox.answer);
if (d.answerBox && d.answerBox.snippet) parts.push(d.answerBox.snippet);
if (d.knowledgeGraph && d.knowledgeGraph.description) parts.push(d.knowledgeGraph.description);
(d.organic || []).slice(0, 4).forEach(function(o) {
if (o.snippet) parts.push(o.title + ‘: ’ + o.snippet);
});
return parts.length ? parts.join(’\n’) : null;
} catch(e) { return null; }
}

function errResp(res, msg, status) {
return res.status(status || 400).json({ error: msg });
}

module.exports = async function handler(req, res) {
// CORS headers
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) { res.status(204).end(); return; }
if (req.method !== ‘POST’) { res.status(405).json({ error: ‘Method not allowed’ }); return; }

const body = req.body || {};
const provider = body.provider || ‘’;
const messages = body.messages || [];
const images = (body.images || []).filter(Boolean);
const serperKey = body.serperKey || ‘’;
const query = body.query || ‘’;
const hasImages = images.length > 0;

const now = new Date().toLocaleString(‘fr-FR’, { timeZone: ‘Europe/Paris’, dateStyle: ‘full’, timeStyle: ‘short’ });
const sysWithDate = SYS + ’ La date et heure actuelle en France est : ’ + now + ‘.’;

let webContext = null;
if (query && needsSearch(query)) {
webContext = await webSearch(query, serperKey);
}

const prevMsgs = messages.slice(0, -1);
const lastContent = messages.length > 0 ? messages[messages.length - 1].content : ‘’;
const enriched = lastContent + (webContext ? ‘\n\n[WEB]\n’ + webContext + ‘\n[/WEB]’ : ‘’);

try {
let answer;

```
if (provider === 'gemini') {
  const gKey = process.env.GEMINI_KEY;
  if (!gKey) return errResp(res, 'GEMINI_KEY manquante');
  const gc = [
    { role: 'user', parts: [{ text: sysWithDate }] },
    { role: 'model', parts: [{ text: 'Compris !' }] },
    ...prevMsgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  ];
  const lastParts = [
    ...images.map(img => ({ inline_data: { mime_type: 'image/jpeg', data: img } })),
    { text: enriched }
  ];
  gc.push({ role: 'user', parts: lastParts });
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + gKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 300, temperature: 0.8 } })
  });
  const d = await r.json();
  if (!r.ok) return errResp(res, 'Gemini: ' + (d.error ? d.error.message : r.status));
  answer = d.candidates[0].content.parts[0].text.trim();

} else if (provider === 'groq') {
  const gKey = process.env.GROQ_KEY;
  if (!gKey) return errResp(res, 'GROQ_KEY manquante');
  const msgs = [
    { role: 'system', content: sysWithDate },
    ...prevMsgs.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: enriched }
  ];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + gKey },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 300, temperature: 0.8, messages: msgs })
  });
  const d = await r.json();
  if (!r.ok) return errResp(res, 'Groq: ' + (d.error ? d.error.message : r.status));
  answer = d.choices[0].message.content.trim();

} else if (provider === 'anthropic') {
  const aKey = process.env.ANTHROPIC_KEY;
  if (!aKey) return errResp(res, 'ANTHROPIC_KEY manquante');
  const antMsgs = [
    ...prevMsgs.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
  ];
  if (hasImages) {
    antMsgs.push({ role: 'user', content: [
      ...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } })),
      { type: 'text', text: enriched }
    ]});
  } else {
    antMsgs.push({ role: 'user', content: enriched });
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: sysWithDate, messages: antMsgs })
  });
  const d = await r.json();
  if (!r.ok) return errResp(res, 'Anthropic: ' + (d.error ? d.error.message : r.status));
  answer = d.content[0].text.trim();

} else if (provider === 'openai') {
  const oKey = process.env.OPENAI_KEY;
  if (!oKey) return errResp(res, 'OPENAI_KEY manquante');
  const oMsgs = [
    { role: 'system', content: sysWithDate },
    ...prevMsgs.map(m => ({ role: m.role, content: m.content }))
  ];
  if (hasImages) {
    oMsgs.push({ role: 'user', content: [
      ...images.map(img => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } })),
      { type: 'text', text: enriched }
    ]});
  } else {
    oMsgs.push({ role: 'user', content: enriched });
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + oKey },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.8, messages: oMsgs })
  });
  const d = await r.json();
  if (!r.ok) return errResp(res, 'OpenAI: ' + (d.error ? d.error.message : r.status));
  answer = d.choices[0].message.content.trim();

} else {
  return errResp(res, 'Provider inconnu: ' + provider);
}

res.status(200).json({ answer: answer });
```

} catch(e) {
errResp(res, ’Erreur: ’ + e.message, 500);
}
};