const CORS = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
};

const SYS = “Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO de Adventure Time. Tu parles TOUJOURS en français et tu tutoies toujours. Tes réponses font 1-3 phrases max. Tu es utile, curieux et légèrement impertinent. L’utilisateur habite en France. Tu as accès à une caméra en temps réel : tu reçois plusieurs images de ce que la caméra voit actuellement. Si les images sont noires, floues ou inexploitables, dis-le honnêtement. Quand des résultats de recherche web te sont fournis, utilise-les pour répondre avec précision.”;

function needsSearch(msg) {
return /météo|temps qu.il fait|température|pleut|soleil|neige|vent|quelle heure|heure est|actualité|news|résultat|score|match|prix|cours|bourse|aujourd.hui|demain/.test(msg.toLowerCase());
}

async function serperSearch(query) {
const key = process.env.SERPER_KEY;
if (!key) return ‘’;
try {
const resp = await fetch(‘https://google.serper.dev/search’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’, ‘X-API-KEY’: key },
body: JSON.stringify({ q: query, gl: ‘fr’, hl: ‘fr’, num: 5 }),
});
if (!resp.ok) return ‘’;
const data = await resp.json();
const parts = [];
if (data.answerBox) parts.push(data.answerBox.answer || data.answerBox.snippet || ‘’);
if (data.organic) {
for (let i = 0; i < Math.min(4, data.organic.length); i++) {
if (data.organic[i].snippet) parts.push(data.organic[i].snippet);
}
}
return parts.filter(Boolean).join(’\n’);
} catch (e) {
return ‘’;
}
}

module.exports = async function handler(req, res) {
// CORS
Object.keys(CORS).forEach(function(k) { res.setHeader(k, CORS[k]); });

if (req.method === ‘OPTIONS’) { res.status(204).end(); return; }
if (req.method !== ‘POST’) { res.status(405).json({ error: ‘Method not allowed’ }); return; }

let body = req.body;
if (!body) {
try {
const chunks = [];
await new Promise(function(resolve, reject) {
req.on(‘data’, function(c) { chunks.push(c); });
req.on(‘end’, resolve);
req.on(‘error’, reject);
});
body = JSON.parse(Buffer.concat(chunks).toString());
} catch (e) {
res.status(400).json({ error: ‘Invalid JSON’ }); return;
}
}

const provider = body.provider;
const messages = body.messages || [];
const images = body.images || [];
const hasImages = images.length > 0;
const lastMsg = messages.length > 0 ? messages[messages.length - 1].content : ‘’;

let searchContext = ‘’;
if (needsSearch(lastMsg)) {
searchContext = await serperSearch(lastMsg + ’ France’);
}

const finalSys = searchContext ? SYS + ‘\n\nRésultats de recherche web :\n’ + searchContext : SYS;

try {
let answer = ‘’;

```
if (provider === 'gemini') {
  const key = process.env.GEMINI_KEY;
  if (!key) { res.status(400).json({ error: 'GEMINI_KEY manquante' }); return; }

  const gc = [
    { role: 'user', parts: [{ text: finalSys }] },
    { role: 'model', parts: [{ text: 'Compris !' }] },
  ];
  for (let i = 0; i < messages.length - 1; i++) {
    gc.push({ role: messages[i].role === 'assistant' ? 'model' : 'user', parts: [{ text: messages[i].content }] });
  }
  const lastParts = [];
  for (let i = 0; i < images.length; i++) {
    lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: images[i] } });
  }
  lastParts.push({ text: lastMsg });
  gc.push({ role: 'user', parts: lastParts });

  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 250, temperature: 0.85 } }),
  });
  const data = await resp.json();
  if (!resp.ok) { res.status(400).json({ error: 'Gemini: ' + (data.error ? data.error.message : resp.status) }); return; }
  answer = data.candidates[0].content.parts[0].text.trim();

} else if (provider === 'groq') {
  const key = process.env.GROQ_KEY;
  if (!key) { res.status(400).json({ error: 'GROQ_KEY manquante' }); return; }

  const groqMsgs = [{ role: 'system', content: finalSys }];
  for (let i = 0; i < messages.length; i++) {
    groqMsgs.push({ role: messages[i].role, content: messages[i].content });
  }
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.85, messages: groqMsgs }),
  });
  const data = await resp.json();
  if (!resp.ok) { res.status(400).json({ error: 'Groq: ' + (data.error ? data.error.message : resp.status) }); return; }
  answer = data.choices[0].message.content.trim();

} else if (provider === 'anthropic') {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) { res.status(400).json({ error: 'ANTHROPIC_KEY manquante' }); return; }

  const anthropicMsgs = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i === messages.length - 1 && m.role === 'user' && hasImages) {
      const content = [];
      for (let j = 0; j < images.length; j++) {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: images[j] } });
      }
      content.push({ type: 'text', text: m.content });
      anthropicMsgs.push({ role: 'user', content: content });
    } else {
      anthropicMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, system: finalSys, messages: anthropicMsgs }),
  });
  const data = await resp.json();
  if (!resp.ok) { res.status(400).json({ error: 'Anthropic: ' + (data.error ? data.error.message : resp.status) }); return; }
  answer = data.content[0].text.trim();

} else if (provider === 'openai') {
  const key = process.env.OPENAI_KEY;
  if (!key) { res.status(400).json({ error: 'OPENAI_KEY manquante' }); return; }

  const oaiMsgs = [{ role: 'system', content: finalSys }];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i === messages.length - 1 && m.role === 'user' && hasImages) {
      const content = [];
      for (let j = 0; j < images.length; j++) {
        content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + images[j] } });
      }
      content.push({ type: 'text', text: m.content });
      oaiMsgs.push({ role: 'user', content: content });
    } else {
      oaiMsgs.push({ role: m.role, content: m.content });
    }
  }
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.85, messages: oaiMsgs }),
  });
  const data = await resp.json();
  if (!resp.ok) { res.status(400).json({ error: 'OpenAI: ' + (data.error ? data.error.message : resp.status) }); return; }
  answer = data.choices[0].message.content.trim();

} else {
  res.status(400).json({ error: 'Provider inconnu: ' + provider }); return;
}

res.status(200).json({ answer: answer });
```

} catch (e) {
res.status(500).json({ error: ’Erreur proxy: ’ + e.message });
}
};