/**
 * sprut-orders — Telegram relay for spruttactical.com.ua
 *
 * Accepts POST { "text": "..." } and delivers the same message to EVERY
 * chat id in CHAT_IDS (comma-separated). Cart orders and RFQ forms both
 * send this exact payload shape from index.html via postTelegramText().
 *
 * Required secrets / vars (Wrangler):
 *   BOT_TOKEN  — Telegram bot token
 *   CHAT_IDS   — comma-separated Telegram chat ids, e.g.
 *                "845123554,1362338508"
 *                (these two ids were the pre-worker dual recipients
 *                 hard-coded in index.html before the Sep 2026 migration)
 *
 * Deploy:
 *   cd cloudflare-worker/sprut-orders
 *   npx wrangler secret put BOT_TOKEN
 *   npx wrangler secret put CHAT_IDS
 *   npx wrangler deploy
 */

const ALLOWED_ORIGIN = 'https://spruttactical.com.ua';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function sendToChat(botToken, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  });
  return res.json();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...corsHeaders() },
      });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: 'no text' }, 400);
    }

    const text = payload && typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      return json({ ok: false, error: 'no text' }, 400);
    }

    const botToken = env.BOT_TOKEN;
    const chatIds = String(env.CHAT_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (!botToken || chatIds.length === 0) {
      return json({ ok: false, error: 'worker misconfigured' }, 500);
    }

    // Fan out to every recipient — same text for cart and RFQ alike.
    const results = await Promise.all(
      chatIds.map((chatId) => sendToChat(botToken, chatId, text))
    );

    const ok = results.every((r) => r && r.ok === true);
    return json({ ok }, ok ? 200 : 502);
  },
};
