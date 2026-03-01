export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Parse body — Vercel ne le fait pas toujours automatiquement
  let body = {};
  try {
    if (req.body && typeof req.body === 'object') {
      body = req.body;
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    }
  } catch(e) { body = {}; }

  const provider = body.provider || '';
  const messages = body.messages || [];
  const images = (body.images || []).filter(Boolean);
  const serperKey = body.serperKey || '';
  const query = body.query || '';
  const hasImgs = images.length > 0;
  const prev = messages.slice(0, -1);
  const lastTxt = messages.length ? (messages[messages.length-1].content || '') : '';

  // Log pour debug
  console.log(`[emo] provider=${provider} msgs=${messages.length} imgs=${images.length} hasGroq=${!!process.env.GROQ_KEY} hasGemini=${!!process.env.GEMINI_KEY}`);

  const now = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
  const SYS = `Tu es Émo, assistant IA sarcastique et attachant inspiré de BMO. TOUJOURS en français, tutoiement, 1-3 phrases max. L'utilisateur habite en France. Date/heure : ${now}. Si tu reçois des images, décris UNIQUEMENT ce que tu vois vraiment. Si des résultats web sont entre [WEB][/WEB], utilise-les.`;

  // Serper search
  let webCtx = null;
  if (query && /heure|météo|meteo|pluie|soleil|neige|actualité|news|aujourd.hui|maintenant|prix|score|match|mort|décès|récent|2025|2026/.test(query.toLowerCase())) {
    const sk = serperKey || process.env.SERPER_KEY;
    if (sk) {
      try {
        const sr = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': sk, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query + ' France', gl: 'fr', hl: 'fr', num: 4 })
        });
        if (sr.ok) {
          const sd = await sr.json();
          const parts = [];
          if (sd.answerBox) parts.push(sd.answerBox.answer || sd.answerBox.snippet || '');
          (sd.organic || []).slice(0,3).forEach(o => { if (o.snippet) parts.push(o.title+': '+o.snippet); });
          if (parts.length) webCtx = parts.join('\n');
        }
      } catch(e) {}
    }
  }

  const enriched = lastTxt + (webCtx ? `\n\n[WEB]\n${webCtx}\n[/WEB]` : '');
  const fail = (msg, code=400) => { console.log(`[emo ERROR] ${msg}`); return res.status(code).json({ error: msg }); };

  try {
    let answer;

    if (provider === 'gemini') {
      const key = process.env.GEMINI_KEY;
      if (!key) return fail('GEMINI_KEY manquante');
      const gc = [
        { role:'user', parts:[{text:SYS}] },
        { role:'model', parts:[{text:'Compris !'}] },
        ...prev.map(m => ({ role: m.role==='assistant'?'model':'user', parts:[{text:m.content}] })),
        { role:'user', parts:[...images.map(i=>({inline_data:{mime_type:'image/jpeg',data:i}})), {text:enriched}] }
      ];
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({contents:gc, generationConfig:{maxOutputTokens:300,temperature:0.8}})
      });
      const d = await r.json();
      if (!r.ok) return fail('Gemini: '+(d.error&&d.error.message||r.status));
      answer = d.candidates[0].content.parts[0].text.trim();

    } else if (provider === 'groq') {
      const key = process.env.GROQ_KEY;
      if (!key) return fail('GROQ_KEY manquante');
      const msgs = [{role:'system',content:SYS}, ...prev.map(m=>({role:m.role,content:m.content})), {role:'user',content:enriched}];
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body: JSON.stringify({model:'llama-3.3-70b-versatile',max_tokens:300,temperature:0.8,messages:msgs})
      });
      const d = await r.json();
      if (!r.ok) return fail('Groq: '+(d.error&&d.error.message||r.status));
      answer = d.choices[0].message.content.trim();

    } else if (provider === 'anthropic') {
      const key = process.env.ANTHROPIC_KEY;
      if (!key) return fail('ANTHROPIC_KEY manquante');
      const am = prev.map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.content}));
      am.push(hasImgs
        ? {role:'user',content:[...images.map(i=>({type:'image',source:{type:'base64',media_type:'image/jpeg',data:i}})),{type:'text',text:enriched}]}
        : {role:'user',content:enriched});
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},
        body: JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYS,messages:am})
      });
      const d = await r.json();
      if (!r.ok) return fail('Anthropic: '+(d.error&&d.error.message||r.status));
      answer = d.content[0].text.trim();

    } else if (provider === 'openai') {
      const key = process.env.OPENAI_KEY;
      if (!key) return fail('OPENAI_KEY manquante');
      const om = [{role:'system',content:SYS}, ...prev.map(m=>({role:m.role,content:m.content}))];
      om.push(hasImgs
        ? {role:'user',content:[...images.map(i=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+i}})),{type:'text',text:enriched}]}
        : {role:'user',content:enriched});
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
        body: JSON.stringify({model:'gpt-4o-mini',max_tokens:300,temperature:0.8,messages:om})
      });
      const d = await r.json();
      if (!r.ok) return fail('OpenAI: '+(d.error&&d.error.message||r.status));
      answer = d.choices[0].message.content.trim();

    } else {
      return fail('Provider inconnu: ' + provider);
    }

    res.status(200).json({ answer });
  } catch(e) {
    res.status(500).json({ error: 'Erreur: '+e.message });
  }
}
