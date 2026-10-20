/**
 * KV-Dumper — Telegram Content Queue Bot (Cloudflare Workers + D1)
 *
 * Entry point. The HTTP side only accepts Telegram webhook calls
 * (authenticated via the secret-token header) and the protected
 * /setwebhook helper. The queue is drained by the cron trigger,
 * which runs the scheduled batch processor every minute.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

import { handleUpdate } from './handlers.js';
import { processQueue } from './processor.js';
import { tgCall } from './telegram.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/webhook' && request.method === 'POST') {
      return handleWebhook(request, env, ctx);
    }

    if (url.pathname === '/setwebhook') {
      return handleSetWebhook(url, env);
    }

    return new Response('KV-Dumper bot is running.');
  },

  /** Cron entry: drains the queue in bounded batches. */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(processQueue(env));
  },
};

/**
 * Webhook receiver. The secret-token check must pass before the
 * payload is parsed or acted upon.
 */
async function handleWebhook(request, env, ctx) {
  if (!env.WEBHOOK_SECRET) {
    return new Response('WEBHOOK_SECRET is not configured.', { status: 500 });
  }
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    // Telegram never sends malformed JSON — anything else is ignored.
    return new Response('Bad Request', { status: 400 });
  }

  ctx.waitUntil(handleUpdate(env, update));
  return new Response('OK');
}

/** Re-register the webhook on Telegram's side. Protected by the shared secret. */
async function handleSetWebhook(url, env) {
  if (!env.WEBHOOK_SECRET) {
    return new Response('WEBHOOK_SECRET is not configured.', { status: 500 });
  }
  if (url.searchParams.get('secret') !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  const result = await tgCall(env, 'setWebhook', {
    url: `https://${url.hostname}/webhook`,
    secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    max_connections: 20,
    drop_pending_updates: false,
  });

  return new Response(JSON.stringify(result, null, 2), {
    status: result.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
