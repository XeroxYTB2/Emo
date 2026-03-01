// Vercel Node.js Serverless Function — CommonJS
const SYS = "Tu es Émo, assistant IA sarcastique et attachant inspiré de BMO. TOUJOURS en français, tutoiement, 1-3 phrases max. L'utilisateur habite en France. Si tu reçois des images, décris UNIQUEMENT ce que tu vois vraiment. Si des résultats web sont entre [WEB][/WEB], utilise-les.";

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function needsSearch(q) {
  return /heure|météo|meteo|pluie|soleil|actualité|news|aujourd.hui|maintenant|prix|score|match|mort|décès|récent|2025|2026/.test(q.toLowerCase());
}

async function webSearch(query, key) {
  try {
    const k = key || process.env.SERPER_KEY;
    if (!k) return null;
    const r = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': k, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query + ' France', gl: 'fr', hl: 'fr', num: 4 })
    });
    const d = await r.json();
    const parts = [];
    if (d.answerBox) parts.push(d.answerBox.answer || d.answerBox.snippet || '');
    (d.organic || []).slice(0, 3).forEach(o => { if (o.snippet) parts.push(o.title + ': ' + o.snippet); });
    return parts.filter(Boolean).join('\n') || null;
  } catch(e) { return null; }
}

module.exports = async function(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const body = req.body || {};
  const provider  = body.provider || '';
  const messages  = body.messages || [];
  const images    = (body.images || []).filter(Boolean);
  const serperKey = body.serperKey || '';
  const query     = body.query || '';
  const hasImgs   = images.length > 0;
  const prev      = messages.slice(0, -1);
  const lastTxt   = (messages[messages.length - 1] || {}).content || '';

  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
  const sys = SYS + ` Date/heure France : ${now}.`;

  const webCtx = (query && needsSearch(query)) ? await webSearch(query, serperKey) : null;
  const enriched = lastTxt + (webCtx ? `\n\n[WEB]\n${webCtx}\n[/WEB]` : '');

  const fail = (msg, code) => res.status(code || 400).json({ error: msg });

  try {
    let answer;

    if (provider === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return fail('GEMINI_KEY manquante');
      const gc = [
        { role: 'user', parts: [{ text: sys }] },
        { role: 'model', parts: [{ text: 'Compris !' }] },
        ...prev.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [...images.map(i => ({ inline_data: { mime_type: 'image/jpeg', data: i } })), { text: enriched }] }
      ];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 300, temperature: 0.8 } })
      });
      const d = await r.json();
      if (!r.ok) return fail('Gemini: ' + (d.error && d.error.message || r.status));
      answer = d.candidates[0].content.parts[0].text.trim();

    } else if (provider === 'groq') {
      const key = process.env.GROQ_KEY;
      if (!key) return fail('GROQ_KEY manquante');
      const msgs = [{ role: 'system', content: sys }, ...prev.map(m => ({ role: m.role, content: m.content })), { role: 'user', content: enriched }];
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 300, temperature: 0.8, messages: msgs })
      });
      const d = await r.json();
      if (!r.ok) return fail('Groq: ' + (d.error && d.error.message || r.status));
      answer = d.choices[0].message.content.trim();

    } else if (provider === 'anthropic') {
      const key = process.env.ANTHROPIC_KEY;
      if (!key) return fail('ANTHROPIC_KEY manquante');
      const antMsgs = [...prev.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))];
      antMsgs.push(hasImgs
        ? { role: 'user', content: [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: i } })), { type: 'text', text: enriched }] }
        : { role: 'user', content: enriched });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, system: sys, messages: antMsgs })
      });
      const d = await r.json();
      if (!r.ok) return fail('Anthropic: ' + (d.error && d.error.message || r.status));
      answer = d.content[0].text.trim();

    } else if (provider === 'openai') {
      const key = process.env.OPENAI_KEY;
      if (!key) return fail('OPENAI_KEY manquante');
      const oMsgs = [{ role: 'system', content: sys }, ...prev.map(m => ({ role: m.role, content: m.content }))];
      oMsgs.push(hasImgs
        ? { role: 'user', content: [...images.map(i => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + i } })), { type: 'text', text: enriched }] }
        : { role: 'user', content: enriched });
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.8, messages: oMsgs })
      });
      const d = await r.json();
      if (!r.ok) return fail('OpenAI: ' + (d.error && d.error.message || r.status));
      answer = d.choices[0].message.content.trim();

    } else {
      return fail('Provider inconnu: ' + provider);
    }

    res.status(200).json({ answer });
  } catch(e) {
    res.status(500).json({ error: 'Erreur: ' + e.message });
  }
};
