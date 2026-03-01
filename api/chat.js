module.exports = function(req, res) {
res.setHeader(‘Access-Control-Allow-Origin’, ‘*’);
res.setHeader(‘Access-Control-Allow-Methods’, ‘POST, OPTIONS’);
res.setHeader(‘Access-Control-Allow-Headers’, ‘Content-Type’);

if (req.method === ‘OPTIONS’) {
res.status(204).end();
return;
}

if (req.method !== ‘POST’) {
res.status(405).json({ error: ‘Method not allowed’ });
return;
}

var body = ‘’;
req.on(‘data’, function(chunk) { body += chunk; });
req.on(‘end’, function() {
var data;
try { data = JSON.parse(body); } catch(e) { res.status(400).json({ error: ‘JSON invalide’ }); return; }

```
var provider = data.provider || 'gemini';
var messages = data.messages || [];
var images = data.images || [];

var SYS = "Tu es Émo, un assistant IA sarcastique inspiré de BMO. Tu parles TOUJOURS en français, tu tutoies. Réponses courtes 1-3 phrases. L'utilisateur habite en France. Tu as accès à une caméra (images jointes). Si les images sont inutilisables dis-le. Cherche sur internet SEULEMENT ce que tu ne peux pas savoir : météo actuelle, actualités récentes, événements en cours. Pour tout le reste réponds directement.";

var key, url, bodyOut;

if (provider === 'gemini') {
  key = process.env.GEMINI_KEY;
  if (!key) { res.status(400).json({ error: 'GEMINI_KEY manquante' }); return; }

  var gc = [
    { role: 'user', parts: [{ text: SYS }] },
    { role: 'model', parts: [{ text: 'Compris !' }] }
  ];

  var i;
  for (i = 0; i < messages.length - 1; i++) {
    gc.push({ role: messages[i].role === 'assistant' ? 'model' : 'user', parts: [{ text: messages[i].content }] });
  }

  var lastParts = [];
  for (i = 0; i < Math.min(images.length, 4); i++) {
    lastParts.push({ inline_data: { mime_type: 'image/jpeg', data: images[i] } });
  }
  if (messages.length > 0) lastParts.push({ text: messages[messages.length - 1].content });
  gc.push({ role: 'user', parts: lastParts });

  url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key;
  bodyOut = JSON.stringify({ contents: gc, generationConfig: { maxOutputTokens: 250, temperature: 0.85 } });

  doFetch(url, { 'Content-Type': 'application/json' }, bodyOut, function(err, resp) {
    if (err) { res.status(500).json({ error: err }); return; }
    try {
      var r = JSON.parse(resp);
      res.status(200).json({ answer: r.candidates[0].content.parts[0].text.trim() });
    } catch(e) { res.status(500).json({ error: 'Parse error: ' + resp.slice(0, 100) }); }
  });

} else if (provider === 'groq') {
  key = process.env.GROQ_KEY;
  if (!key) { res.status(400).json({ error: 'GROQ_KEY manquante' }); return; }

  var gmsgs = [{ role: 'system', content: SYS }];
  for (var j = 0; j < messages.length; j++) gmsgs.push(messages[j]);

  url = 'https://api.groq.com/openai/v1/chat/completions';
  bodyOut = JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 250, temperature: 0.85, messages: gmsgs });

  doFetch(url, { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, bodyOut, function(err, resp) {
    if (err) { res.status(500).json({ error: err }); return; }
    try {
      var r = JSON.parse(resp);
      res.status(200).json({ answer: r.choices[0].message.content.trim() });
    } catch(e) { res.status(500).json({ error: 'Parse error' }); }
  });

} else if (provider === 'anthropic') {
  key = process.env.ANTHROPIC_KEY;
  if (!key) { res.status(400).json({ error: 'ANTHROPIC_KEY manquante' }); return; }

  url = 'https://api.anthropic.com/v1/messages';
  bodyOut = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, system: SYS, messages: messages });

  doFetch(url, { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, bodyOut, function(err, resp) {
    if (err) { res.status(500).json({ error: err }); return; }
    try {
      var r = JSON.parse(resp);
      res.status(200).json({ answer: r.content[0].text.trim() });
    } catch(e) { res.status(500).json({ error: 'Parse error' }); }
  });

} else {
  res.status(400).json({ error: 'Provider inconnu' });
}
```

});
};

function doFetch(url, headers, body, cb) {
var https = require(‘https’);
var http = require(‘http’);
var parsed = new URL(url);
var opts = {
hostname: parsed.hostname,
path: parsed.pathname + (parsed.search || ‘’),
method: ‘POST’,
headers: Object.assign({ ‘Content-Length’: Buffer.byteLength(body) }, headers)
};
var mod = parsed.protocol === ‘https:’ ? https : http;
var req = mod.request(opts, function(resp) {
var out = ‘’;
resp.on(‘data’, function(c) { out += c; });
resp.on(‘end’, function() { cb(null, out); });
});
req.on(‘error’, function(e) { cb(e.message, null); });
req.write(body);
req.end();
}