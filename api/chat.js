export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYS = "Tu es Émo, un assistant IA sarcastique et attachant, inspiré de BMO de Adventure Time. Tu parles TOUJOURS en français et tu tutoies toujours. Tes réponses font 1-3 phrases max. Tu es utile, curieux et légèrement impertinent. IMPORTANT : tu as accès à une caméra en temps réel. À chaque message tu reçois une image de ce que la caméra filme. Utilise-la naturellement pour répondre aux questions visuelles (météo par la fenêtre, nourriture prête, etc.). Si l'image n'est pas pertinente, ignore-la simplement.";

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); }
  catch(e) { return err('Invalid JSON: ' + e.message); }

  const { provider, messages, image } = body;

  // Log pour debug
  const hasImage = !!(image && image.length > 100);
  console.log(`[proxy] provider=${provider} msgs=${messages?.length} hasImage=${hasImage} imageLen=${image?.length || 0}`);

  try {
    let answer;

    // ── GEMINI ──
    if (provider === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return err('GEMINI_KEY manquante sur Vercel');

      // Construit les messages au format Gemini
      const gc = [];

      // System comme premier échange
      gc.push({ role: 'user', parts: [{ text: SYS }] });
      gc.push({ role: 'model', parts: [{ text: 'Compris, je suis Émo !' }] });

      // Historique
      for (let i = 0; i < messages.length - 1; i++) {
        const m = messages[i];
        gc.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
      }

      // Dernier message — avec image si dispo
      const lastMsg = messages[messages.length - 1];
      const lastParts = [];

      if (hasImage) {
        lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
      }
      lastParts.push({ text: lastMsg.content });

      gc.push({ role: 'user', parts: lastParts });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 250, temperature: 0.85 } })
      });
      const data = await resp.json();
      if (!resp.ok) return err('Gemini: ' + (data?.error?.message || resp.status));
      answer = data.candidates[0].content.parts[0].text.trim();

    // ── ANTHROPIC ──
    } else if (provider === 'anthropic') {
      const key = process.env.ANTHROPIC_KEY;
      if (!key) return err('ANTHROPIC_KEY manquante sur Vercel');

      const anthropicMessages = messages.map((m, i) => {
        // Dernier message user — ajoute l'image
        if (i === messages.length - 1 && m.role === 'user' && hasImage) {
          return {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
              { type: 'text', text: m.content }
            ]
          };
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
      });

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, system: SYS, messages: anthropicMessages })
      });
      const data = await resp.json();
      if (!resp.ok) return err('Anthropic: ' + (data?.error?.message || resp.status));
      answer = data.content[0].text.trim();

    // ── GROQ ──
    } else if (provider === 'groq') {
      const key = process.env.GROQ_KEY;
      if (!key) return err('GROQ_KEY manquante sur Vercel');

      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.85,
          messages: [{ role: 'system', content: SYS + (hasImage ? ' (Note: une image est disponible mais ce modèle ne peut pas la voir)' : '') }, ...messages]
        })
      });
      const data = await resp.json();
      if (!resp.ok) return err('Groq: ' + (data?.error?.message || resp.status));
      answer = data.choices[0].message.content.trim();

    // ── OPENAI ──
    } else if (provider === 'openai') {
      const key = process.env.OPENAI_KEY;
      if (!key) return err('OPENAI_KEY manquante sur Vercel');

      const oaiMessages = [{ role: 'system', content: SYS }];
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (i === messages.length - 1 && m.role === 'user' && hasImage) {
          oaiMessages.push({ role: 'user', content: [
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } },
            { type: 'text', text: m.content }
          ]});
        } else {
          oaiMessages.push({ role: m.role, content: m.content });
        }
      }

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 250, temperature: 0.85, messages: oaiMessages })
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

  } catch(e) {
    return err('Erreur proxy: ' + e.message, 500);
  }
}

function err(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}
