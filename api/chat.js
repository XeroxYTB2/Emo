export const config = { runtime: ‘edge’ };

const CORS = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘POST, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
};

const SYS = “Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO de Adventure Time. Tu parles TOUJOURS en français et tu tutoies toujours. Tes réponses font 1-3 phrases max. Tu es utile, curieux et légèrement impertinent. L’utilisateur habite en France. Tu as accès à une caméra en temps réel : tu reçois plusieurs images de ce que la caméra voit. Si les images sont noires, floues ou inexploitables, dis-le honnêtement plutôt qu’inventer. Quand des résultats de recherche web te sont fournis, utilise-les pour répondre avec précision.”;

// Détecte si la question nécessite une recherche web
function needsSearch(msg) {
const t = msg.toLowerCase();
return /météo|temps qu.il fait|température|pleut|soleil|neige|vent|heure|quelle heure|actualité|news|résultat|score|match|prix|cours|bourse|aujourd.hui|demain|hier|cette semaine/.test(t);
}

// Recherche Serper (Google)
async function serperSearch(query) {
const key = process.env.SERPER_KEY;
if (!key) return null;
const resp = await fetch(‘https://google.serper.dev/search’, {
method: ‘POST’,
headers: { ‘Content-Type’: ‘application/json’, ‘X-API-KEY’: key },
body: JSON.stringify({ q: query, gl: ‘fr’, hl: ‘fr’, num: 5 })
});
if (!resp.ok) return null;
const data = await resp.json();
// Extrait les snippets pertinents
const results = [];
if (data.answerBox) results.push(data.answerBox.answer || data.answerBox.snippet || ‘’);
if (data.organic) data.organic.slice(0, 4).forEach(r => results.push(r.snippet || ‘’));
return results.filter(Boolean).join(’\n’);
}

export default async function handler(req) {
if (req.method === ‘OPTIONS’) return new Response(null, { status: 204, headers: CORS });
if (req.method !== ‘POST’) return new Response(‘Method not allowed’, { status: 405, headers: CORS });

let body;
try { body = await req.json(); }
catch(e) { return err(‘Invalid JSON’); }

const { provider, messages, images } = body;
const lastMsg = messages[messages.length - 1]?.content || ‘’;
const hasImages = !!(images && images.length > 0);

// Recherche web si nécessaire
let searchContext = ‘’;
if (needsSearch(lastMsg)) {
searchContext = await serperSearch(lastMsg + ’ France’).catch(() => ‘’);
}

// Enrichit le SYS avec contexte de recherche si dispo
const finalSys = searchContext
? SYS + ‘\n\nRésultats de recherche web (utilise ces infos pour répondre) :\n’ + searchContext
: SYS;

console.log(`[proxy] provider=${provider} msgs=${messages.length} hasImages=${hasImages} search=${!!searchContext}`);

try {
let answer;

```
if (provider === 'gemini') {
  const key = process.env.GEMINI_KEY;
  if (!key) return err('GEMINI_KEY manquante');

  const gc = [];
  gc.push({ role: 'user', parts: [{ text: finalSys }] });
  gc.push({ role: 'model', parts: [{ text: 'Compris, je suis Émo !' }] });

  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    gc.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }

  // Dernier message avec images
  const lastParts = [];
  if (hasImages) {
    images.forEach(img => {
      lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: img } });
    });
  }
  lastParts.push({ text: lastMsg });
  gc.push({ role: 'user', parts: lastParts });

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 250, temperature: 0.85 } })
  });
  const data = await resp.json();
  if (!resp.ok) return err('Gemini: ' + (data?.error?.message || resp.status));
  answer = data.candidates[0].content.parts[0].text.trim();

} else if (provider === 'groq') {
  const key = process.env.GROQ_KEY;
  if (!key) return err('GROQ_KEY manquante');
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.85,
      messages: [{ role: 'system', content: finalSys }, ...messages] })
  });
  const data = await resp.json();
  if (!resp.ok) return err('Groq: ' + (data?.error?.message || resp.status));
  answer = data.choices[0].message.content.trim();

} else if (provider === 'anthropic') {
  const key = process.env.ANTHROPIC_KEY;
  if (!key) return err('ANTHROPIC_KEY manquante');
  const anthropicMsgs = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === 'user' && hasImages) {
      const content = [];
      images.forEach(img => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }));
      content.push({ type: 'text', text: m.content });
      return { role: 'user', content };
    }
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
  });
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, system: finalSys, messages: anthropicMsgs })
  });
  const data = await resp.json();
  if (!resp.ok) return err('Anthropic: ' + (data?.error?.message || resp.status));
  answer = data.content[0].text.trim();

} else if (provider === 'openai') {
  const key = process.env.OPENAI_KEY;
  if (!key) return err('OPENAI_KEY manquante');
  const oaiMsgs = [{ role: 'system', content: finalSys }];
  messages.forEach((m, i) => {
    if (i === messages.length - 1 && m.role === 'user' && hasImages) {
      const content = [];
      images.forEach(img => content.push({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + img } }));
      content.push({ type: 'text', text: m.content });
      oaiMsgs.push({ role: 'user', content });
    } else {
      oaiMsgs.push({ role: m.role, content: m.content });
    }
  });
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.85, messages: oaiMsgs })
  });
  const data = await resp.json();
  if (!resp.ok) return err('OpenAI: ' + (data?.error?.message || resp.status));
  answer = data.choices[0].message.content.trim();

} else {
  return err('Provider inconnu: ' + provider);
}

return new Response(JSON.stringify({ answer }), {
  status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
});
```

} catch(e) {
return err(’Erreur proxy: ’ + e.message, 500);
}
}

function err(msg, status = 400) {
return new Response(JSON.stringify({ error: msg }), {
status, headers: { …CORS, ‘Content-Type’: ‘application/json’ }
});
}