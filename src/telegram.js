/**
 * KV-Dumper — Telegram Bot API client
 *
 * Every call goes through tgCall() so response bodies are parsed and
 * errors — including flood-control retry_after — surface in a
 * structured form instead of a bare boolean.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

/**
 * Call a Telegram Bot API method.
 *
 * @param {object} env Worker environment (requires BOT_TOKEN)
 * @param {string} method Bot API method name, e.g. "sendMessage"
 * @param {object} payload JSON body sent to the API
 * @returns {Promise<{ ok: true, result: any } |
 *                  { ok: false, status: number|null, description: string, retryAfter: number|null }>}
 */
export async function tgCall(env, method, payload = {}) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return { ok: false, status: null, description: `network error: ${error.message}`, retryAfter: null };
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body — fall through to the generic branch below.
  }

  if (data && typeof data === 'object' && 'ok' in data) {
    if (data.ok) {
      return { ok: true, result: data.result };
    }
    return {
      ok: false,
      status: res.status,
      description: String(data.description || 'unknown Telegram error'),
      retryAfter: (data.parameters && data.parameters.retry_after) ?? null,
    };
  }

  return { ok: false, status: res.status, description: `HTTP ${res.status}`, retryAfter: null };
}

/**
 * Escape a dynamic string for safe embedding inside HTML-parsed messages.
 * Apply to every value that did not come from this codebase.
 */
export function escapeHtml(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send an HTML-formatted message to the admin chat.
 * Dynamic values MUST be escaped with escapeHtml() before interpolation.
 */
export async function sendAdminMessage(env, text, replyMarkup = null) {
  const body = { chat_id: env.ADMIN_ID, text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tgCall(env, 'sendMessage', body);
}
