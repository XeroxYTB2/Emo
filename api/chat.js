export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  let body;
  try { body = await req.json(); }
  catch(e) { return new Response(JSON.stringify({error:'Invalid JSON'}), {status:400,headers:{...CORS,'Content-Type':'application/json'}}); }

  const { provider, messages, system } = body;

  let url, opts;
  const SYS = system || 'Tu es Émo, un assistant IA sarcastique inspiré de BMO de Adventure Time. Tu réponds TOUJOURS en français. Tes réponses font 1-3 phrases max.';

  try {
    if (provider === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return err('GEMINI_KEY non configurée sur Vercel');
      const gc = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      gc.unshift({ role: 'user', parts: [{ text: SYS }] }, { role: 'model', parts: [{ text: 'Compris.' }] });
      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 200, temperature: 0.85 } }) };

    } else if (provider === 'groq') {
      const key = process.env.GROQ_KEY;
      if (!key) return err('GROQ_KEY non configurée sur Vercel');
      url = 'https://api.groq.com/openai/v1/chat/completions';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 200, temperature: 0.85,
          messages: [{ role: 'system', content: SYS }, ...messages] }) };

    } else if (provider === 'anthropic') {
      const key = process.env.ANTHROPIC_KEY;
      if (!key) return err('ANTHROPIC_KEY non configurée sur Vercel');
      url = 'https://api.anthropic.com/v1/messages';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: SYS, messages }) };

    } else if (provider === 'openai') {
      const key = process.env.OPENAI_KEY;
      if (!key) return err('OPENAI_KEY non configurée sur Vercel');
      url = 'https://api.openai.com/v1/chat/completions';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 160, temperature: 0.85,
          messages: [{ role: 'system', content: SYS }, ...messages] }) };

    } else {
      return err('Provider inconnu : ' + provider);
    }

    const resp = await fetch(url, opts);
    const data = await resp.json();

    if (!resp.ok) {
      const msg = data?.error?.message || ('Erreur ' + resp.status);
      return err(provider + ' : ' + msg, resp.status);
    }

    // Parse selon provider
    let answer = '';
    if (provider === 'gemini')    answer = data.candidates[0].content.parts[0].text.trim();
    else if (provider === 'anthropic') answer = data.content[0].text.trim();
    else answer = data.choices[0].message.content.trim();

    return new Response(JSON.stringify({ answer }), {
      status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch(e) {
    return err('Erreur proxy : ' + e.message, 500);
  }
}

function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
