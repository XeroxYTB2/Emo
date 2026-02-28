export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYS = 'Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO de Adventure Time. Tu parles TOUJOURS en français, tu tutoies toujours ton interlocuteur. Tes réponses font 1-3 phrases max. Tu es utile, curieux, légèrement impertinent mais toujours bienveillant. Quand on te montre une image, tu la décris avec précision et tu proposes ton aide.';

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); }
  catch(e) { return err('Invalid JSON'); }

  const { provider, messages, image } = body;

  try {
    let url, opts, answer;

    // ── GEMINI ──
    if (provider === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return err('GEMINI_KEY manquante');

      const gc = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      gc.unshift({ role: 'user', parts: [{ text: SYS }] }, { role: 'model', parts: [{ text: 'Compris !' }] });

      // Si image fournie, l'ajoute au dernier message user
      if (image) {
        const last = gc[gc.length - 1];
        if (last.role === 'user') {
          last.parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
        }
      }

      url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
      opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 250, temperature: 0.85 } }) };

      const resp = await fetch(url, opts);
      const data = await resp.json();
      if (!resp.ok) return err('Gemini: ' + (data?.error?.message || resp.status));
      answer = data.candidates[0].content.parts[0].text.trim();

    // ── GROQ ──
    } else if (provider === 'groq') {
      const key = process.env.GROQ_KEY;
      if (!key) return err('GROQ_KEY manquante');

      // Groq ne supporte pas les images — ignore l'image
      url = 'https://api.groq.com/openai/v1/chat/completions';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.85,
          messages: [{ role: 'system', content: SYS }, ...messages] }) };

      const resp = await fetch(url, opts);
      const data = await resp.json();
      if (!resp.ok) return err('Groq: ' + (data?.error?.message || resp.status));
      answer = data.choices[0].message.content.trim();

    // ── ANTHROPIC ──
    } else if (provider === 'anthropic') {
      const key = process.env.ANTHROPIC_KEY;
      if (!key) return err('ANTHROPIC_KEY manquante');

      let anthropicMessages = [...messages];

      // Si image, ajoute au dernier message
      if (image) {
        const lastMsg = anthropicMessages[anthropicMessages.length - 1];
        anthropicMessages[anthropicMessages.length - 1] = {
          role: lastMsg.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
            { type: 'text', text: lastMsg.content }
          ]
        };
      }

      url = 'https://api.anthropic.com/v1/messages';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, system: SYS, messages: anthropicMessages }) };

      const resp = await fetch(url, opts);
      const data = await resp.json();
      if (!resp.ok) return err('Anthropic: ' + (data?.error?.message || resp.status));
      answer = data.content[0].text.trim();

    // ── OPENAI ──
    } else if (provider === 'openai') {
      const key = process.env.OPENAI_KEY;
      if (!key) return err('OPENAI_KEY manquante');

      let oaiMessages = [{ role: 'system', content: SYS }, ...messages];
      if (image) {
        const last = oaiMessages[oaiMessages.length - 1];
        oaiMessages[oaiMessages.length - 1] = {
          role: last.role,
          content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } },
            { type: 'text', text: last.content }
          ]
        };
      }

      url = 'https://api.openai.com/v1/chat/completions';
      opts = { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.85, messages: oaiMessages }) };

      const resp = await fetch(url, opts);
      const data = await resp.json();
      if (!resp.ok) return err('OpenAI: ' + (data?.error?.message || resp.status));
      answer = data.choices[0].message.content.trim();

    } else {
      return err('Provider inconnu : ' + provider);
    }

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
