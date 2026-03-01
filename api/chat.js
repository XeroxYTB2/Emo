export const config = { runtime: ‘edge’ };

const CORS = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
};

const SYS = “Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO. Tu parles TOUJOURS en français, tu tutoies toujours, tu fais 1-3 phrases max. L’utilisateur habite en France (fuseau Europe/Paris). RÈGLES : (1) Tu reçois parfois des images de la caméra — décris UNIQUEMENT ce que tu vois vraiment, n’invente rien, si c’est flou dis-le. (2) Quand des résultats web sont fournis entre [WEB] et [/WEB], utilise-les pour répondre avec précision. (3) Pour l’heure, la météo, l’actualité : la réponse est dans le contexte web fourni.”;

function needsSearch(q) {
var t = q.toLowerCase();
return /heure|temps|météo|meteo|tempér|chaud|froid|pluie|soleil|neige|vent|actualité|news|aujourd.hui|maintenant|en ce moment|prix|résultat|score|match|élection|président|premier ministre|mort|décès|sorti|nouveau|dernièr|récent|2024|2025|2026/.test(t);
}

async function webSearch(query, serperKey) {
try {
var key = serperKey || process.env.SERPER_KEY;
if (!key) return null;
var resp = await fetch(‘https://google.serper.dev/search’, {
method: ‘POST’,
headers: { ‘X-API-KEY’: key, ‘Content-Type’: ‘application/json’ },
body: JSON.stringify({ q: query + ’ France’, gl: ‘fr’, hl: ‘fr’, num: 5 })
});
if (!resp.ok) return null;
var data = await resp.json();
var parts = [];
if (data.answerBox && data.answerBox.answer) parts.push(data.answerBox.answer);
if (data.answerBox && data.answerBox.snippet) parts.push(data.answerBox.snippet);
if (data.knowledgeGraph && data.knowledgeGraph.description) parts.push(data.knowledgeGraph.description);
var organic = data.organic || [];
for (var i = 0; i < Math.min(organic.length, 4); i++) {
if (organic[i].snippet) parts.push(organic[i].title + ‘: ’ + organic[i].snippet);
}
return parts.length ? parts.join(’\n’) : null;
} catch(e) {
return null;
}
}

export default async function handler(req) {
if (req.method === ‘OPTIONS’) return new Response(null, { status: 204, headers: CORS });
if (req.method !== ‘POST’) return new Response(‘Method not allowed’, { status: 405, headers: CORS });

var body;
try { body = await req.json(); }
catch(e) { return err(‘Invalid JSON’); }

var provider = body.provider;
var messages = body.messages || [];
var images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
var serperKey = body.serperKey || ‘’;
var query = body.query || ‘’;
var hasImages = images.length > 0;

var now = new Date().toLocaleString(‘fr-FR’, { timeZone: ‘Europe/Paris’, dateStyle: ‘full’, timeStyle: ‘short’ });
var sysWithDate = SYS + ’ La date et heure actuelle en France est : ’ + now + ‘.’;

var webContext = null;
if (query && needsSearch(query)) {
webContext = await webSearch(query, serperKey);
}

var lastMsg = messages.length > 0 ? messages[messages.length - 1] : { content: ‘’ };
var enrichedMsg = lastMsg.content + (webContext ? ‘\n\n[WEB]\n’ + webContext + ‘\n[/WEB]’ : ‘’);
var prevMsgs = messages.slice(0, -1);

try {
var answer;

```
if (provider === 'gemini') {
  var key = process.env.GEMINI_KEY;
  if (!key) return err('GEMINI_KEY manquante');

  var gc = [];
  gc.push({ role: 'user', parts: [{ text: sysWithDate }] });
  gc.push({ role: 'model', parts: [{ text: 'Compris !' }] });
  for (var i = 0; i < prevMsgs.length; i++) {
    gc.push({ role: prevMsgs[i].role === 'assistant' ? 'model' : 'user', parts: [{ text: prevMsgs[i].content }] });
  }
  var lastParts = [];
  for (var j = 0; j < images.length; j++) {
    lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: images[j] } });
  }
  lastParts.push({ text: enrichedMsg });
  gc.push({ role: 'user', parts: lastParts });

  var resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 300, temperature: 0.8 } })
  });
  var data = await resp.json();
  if (!resp.ok) return err('Gemini: ' + (data.error ? data.error.message : resp.status));
  answer = data.candidates[0].content.parts[0].text.trim();

} else if (provider === 'groq') {
  var key = process.env.GROQ_KEY;
  if (!key) return err('GROQ_KEY manquante');

  var groqMsgs = [{ role: 'system', content: sysWithDate }];
  for (var i = 0; i < prevMsgs.length; i++) {
    groqMsgs.push({ role: prevMsgs[i].role, content: prevMsgs[i].content });
  }
  groqMsgs.push({ role: 'user', content: enrichedMsg });

  var resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 300, temperature: 0.8, messages: groqMsgs })
  });
  var data = await resp.json();
  if (!resp.ok) return err('Groq: ' + (data.error ? data.error.message : resp.status));
  answer = data.choices[0].message.content.trim();

} else if (provider === 'anthropic') {
  var key = process.env.ANTHROPIC_KEY;
  if (!key) return err('ANTHROPIC_KEY manquante');

  var antMsgs = [];
  for (var i = 0; i < prevMsgs.length; i++) {
    antMsgs.push({ role: prevMsgs[i].role === 'assistant' ? 'assistant' : 'user', content: prevMsgs[i].content });
  }
  if (hasImages) {
    var content = [];
    for (var j = 0; j < images.length; j++) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: images[j] } });
    }
    content.push({ type: 'text', text: enrichedMsg });
    antMsgs.push({ role: 'user', content: content });
  } else {
    antMsgs.push({ role: 'user', content: enrichedMsg });
  }

  var resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: sysWithDate, messages: antMsgs })
  });
  var data = await resp.json();
  if (!resp.ok) return err('Anthropic: ' + (data.error ? data.error.message : resp.status));
  answer = data.content[0].text.trim();

} else if (provider === 'openai') {
  var key = process.env.OPENAI_KEY;
  if (!key) return err('OPENAI_KEY manquante');

  var oaiMsgs = [{ role: 'system', content: sysWithDate }];
  for (var i = 0; i < prevMsgs.length; i++) {
    oaiMsgs.push({ role: prevMsgs[i].role, content: prevMsgs[i].content });
  }
  if (hasImages) {
    var content = [];
    for (var j = 0; j < images.length; j++) {
      content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + images[j] } });
    }
    content.push({ type: 'text', text: enrichedMsg });
    oaiMsgs.push({ role: 'user', content: content });
  } else {
    oaiMsgs.push({ role: 'user', content: enrichedMsg });
  }

  var resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.8, messages: oaiMsgs })
  });
  var data = await resp.json();
  if (!resp.ok) return err('OpenAI: ' + (data.error ? data.error.message : resp.status));
  answer = data.choices[0].message.content.trim();

} else {
  return err('Provider inconnu: ' + provider);
}

return new Response(JSON.stringify({ answer: answer }), {
  status: 200, headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
});
```

} catch(e) {
return err(’Erreur: ’ + e.message, 500);
}
}

function err(msg, status) {
return new Response(JSON.stringify({ error: msg }), {
status: status || 400,
headers: Object.assign({}, CORS, { ‘Content-Type’: ‘application/json’ })
});
}
