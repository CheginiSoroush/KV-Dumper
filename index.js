/**
 * KV-Dumper — Telegram Content Queue Bot (Cloudflare Workers + D1)
 *
 * Security-hardened webhook layer:
 *   - /webhook only accepts requests carrying Telegram's secret token
 *     (X-Telegram-Bot-Api-Secret-Token), so third parties cannot spoof
 *     updates or spam the admin chat with fake error logs.
 *   - /setwebhook is protected by the same shared secret.
 *   - All admin notifications are sent as plain text so dynamic content
 *     can never break message entity parsing.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

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
};

// ----------------- HTTP endpoints -----------------

/**
 * Entry point for Telegram updates. The secret-token check must pass
 * before the payload is parsed or acted upon.
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
    // Telegram never sends malformed JSON — anything else is not worth logging.
    return new Response('Bad Request', { status: 400 });
  }

  const message = update.message;
  if (message && message.from && String(message.from.id) === String(env.ADMIN_ID)) {
    // waitUntil keeps the Worker alive while a command is being processed.
    ctx.waitUntil(
      handleAdminCommand(env, message).catch(error => {
        sendPlainText(env, env.ADMIN_ID, `🚨 خطا در دستور ادمین: ${error.message}`);
      })
    );
  }

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

  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `https://${url.hostname}/webhook`,
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false,
    }),
  });

  return new Response(await res.text(), {
    status: res.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ----------------- Admin panel -----------------

function getAdminPanel() {
  return JSON.stringify({
    keyboard: [
      [{ text: '🚀 ارسال تمام محتواها به کانال' }, { text: '🗑 پاکسازی صف' }],
      [{ text: '📊 آمار صف' }, { text: '🔌 روشن/خاموش کردن سیستم' }],
    ],
    resize_keyboard: true,
  });
}

async function handleAdminCommand(env, message) {
  const chatId = message.chat.id;
  const text = message.text;
  let responseText = '';
  const replyMarkup = getAdminPanel();

  try {
    const statusRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'bot_status'").first();
    const botStatus = statusRes ? statusRes.value : 'on';

    if (botStatus === 'off' && text !== '🔌 روشن/خاموش کردن سیستم') {
      await sendPlainText(env, chatId, '🔴 سیستم خاموش است. ابتدا آن را روشن کنید.', getAdminPanel());
      return;
    }

    // Content queueing (photos, videos and plain text).
    if (message.photo) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const caption = message.caption || '';
      await env.db1
        .prepare("INSERT INTO queue (type, content, caption) VALUES ('photo', ?, ?)")
        .bind(fileId, caption)
        .run();
      await sendPlainText(env, chatId, '✅ عکس به صف ارسال اضافه شد.', getAdminPanel());
      return;
    }

    if (message.video) {
      const fileId = message.video.file_id;
      const caption = message.caption || '';
      await env.db1
        .prepare("INSERT INTO queue (type, content, caption) VALUES ('video', ?, ?)")
        .bind(fileId, caption)
        .run();
      await sendPlainText(env, chatId, '✅ ویدیو به صف ارسال اضافه شد.', getAdminPanel());
      return;
    }

    const isPanelButton =
      text === '🚀 ارسال تمام محتواها به کانال' ||
      text === '🗑 پاکسازی صف' ||
      text === '📊 آمار صف' ||
      text === '🔌 روشن/خاموش کردن سیستم';

    if (text && !text.startsWith('/') && !isPanelButton) {
      await env.db1
        .prepare("INSERT INTO queue (type, content, caption) VALUES ('text', ?, '')")
        .bind(text)
        .run();
      await sendPlainText(env, chatId, '✅ متن به صف ارسال اضافه شد.', getAdminPanel());
      return;
    }

    // Panel commands.
    if (text === '/start') {
      responseText =
        'به ربات صف‌کننده محتوا خوش آمدید!\n' +
        'هر عکس، ویدیو یا متنی که بفرستید در صف ذخیره می‌شود. ' +
        'روی «ارسال تمام محتواها» بزنید تا با تاخیر ۱۰ ثانیه‌ای به کانال بروند.';
    } else if (text === '🚀 ارسال تمام محتواها به کانال' || text === '/now') {
      await sendPlainText(
        env,
        chatId,
        '⏳ شروع ارسال صف... این عملیات ممکن است طول بکشد.',
        getAdminPanel()
      );
      await processQueue(env);
      return;
    } else if (text === '🗑 پاکسازی صف' || text === '/clear') {
      await env.db1.prepare('DELETE FROM queue').run();
      responseText = '🗑 صف محتوا با موفقیت خالی شد.';
    } else if (text === '📊 آمار صف') {
      const countRes = await env.db1.prepare('SELECT COUNT(*) as count FROM queue').first();
      responseText = `📊 تعداد محتواهای در صف انتظار: ${countRes ? countRes.count : 0} مورد.`;
    } else if (text === '🔌 روشن/خاموش کردن سیستم') {
      const newStatus = botStatus === 'on' ? 'off' : 'on';
      await env.db1
        .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('bot_status', ?)")
        .bind(newStatus)
        .run();
      responseText = newStatus === 'on' ? '🟢 سیستم روشن شد.' : '🔴 سیستم خاموش شد.';
    } else {
      responseText = 'لطفاً یک عکس، ویدیو یا متن بفرستید تا در صف قرار گیرد، یا از دکمه‌های پنل استفاده کنید.';
    }

    await sendPlainText(env, chatId, responseText, replyMarkup);
  } catch (error) {
    await sendPlainText(env, chatId, `🚨 خطا:\n${error.message}`, getAdminPanel());
  }
}

// ----------------- Queue processing -----------------

/**
 * Drains the queue with a 10-second anti-flood interval.
 * Note: replaced by the scheduled batch processor in the next release.
 */
async function processQueue(env) {
  let sentCount = 0;
  let failedCount = 0;

  for (;;) {
    const item = await env.db1.prepare('SELECT * FROM queue ORDER BY id LIMIT 1').first();
    if (!item) break;

    let success = false;
    try {
      if (item.type === 'text') {
        success = await sendChannelContent(env, 'sendMessage', { chat_id: env.CHANNEL_ID, text: item.content });
      } else if (item.type === 'photo') {
        success = await sendChannelContent(env, 'sendPhoto', {
          chat_id: env.CHANNEL_ID,
          photo: item.content,
          caption: item.caption,
        });
      } else if (item.type === 'video') {
        success = await sendChannelContent(env, 'sendVideo', {
          chat_id: env.CHANNEL_ID,
          video: item.content,
          caption: item.caption,
        });
      }
    } catch {
      success = false;
    }

    if (success) {
      sentCount++;
    } else {
      failedCount++;
    }

    // Remove the item either way so the queue can never get stuck.
    await env.db1.prepare('DELETE FROM queue WHERE id = ?').bind(item.id).run();

    // Anti-flood pause before the next item.
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  await sendPlainText(
    env,
    env.ADMIN_ID,
    `✅ پردازش صف به پایان رسید.\n\nارسال موفق: ${sentCount}\nارسال ناموفق: ${failedCount}`
  );
}

// ----------------- Telegram helpers -----------------

/**
 * Call a channel-facing Bot API method. The response body is parsed so
 * failures carry their real cause instead of a bare boolean.
 */
async function sendChannelContent(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  try {
    const data = await res.json();
    return Boolean(data && data.ok);
  } catch {
    return false;
  }
}

/**
 * Send a message as plain text. Deliberately no parse_mode: dynamic
 * content (error messages, user text) must never break entity parsing.
 */
async function sendPlainText(env, chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
