// Run on your bot host; never bundle provider keys into the app.
const {MINES_API, MINES_BOT_TOKEN, AI_ENDPOINT, AI_TOKEN} = process.env;
if (!MINES_API || !MINES_BOT_TOKEN || !AI_ENDPOINT) throw new Error('Set MINES_API, MINES_BOT_TOKEN and AI_ENDPOINT');
async function api(op, data = {}) {
 const response = await fetch(MINES_API, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Authorization: `Bearer ${MINES_BOT_TOKEN}`},
  body: JSON.stringify({op, ...data}),
  signal: AbortSignal.timeout(15000)
 });
 const body = await response.json();
 if (!response.ok || body.error) throw new Error(body.error || `HTTP ${response.status}`);
 return body.data;
}
const seen = new Set((await api('bot_poll')).messages.map(m => m.id));
console.log('Bot connected. Waiting for /ai messages.');
for (;;) {
 try {
  const {messages} = await api('bot_poll');
  for (const m of messages) {
   if (seen.has(m.id)) continue;
   if (m.bot_name || !m.text.startsWith('/ai ')) {
    seen.add(m.id);
    continue;
   }
   const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...(AI_TOKEN ? {Authorization: `Bearer ${AI_TOKEN}`} : {})},
    body: JSON.stringify({
     text: m.text.slice(4),
     messages: messages
      .filter(x => x.time <= m.time)
      .slice(-12)
      .map(x => ({text: x.text, role: x.bot_name ? 'assistant' : 'user'}))
    }),
    signal: AbortSignal.timeout(60000)
   });
   if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
   const result = await response.json();
   if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('AI endpoint must return {text}');
   await api('bot_message', {text: [...result.text].slice(0, 2000).join('')});
   seen.add(m.id);
  }
 } catch (e) {
  console.error('Bot request failed:', e.message);
 }
 await new Promise(r => setTimeout(r, 2500));
}
