/**
 * KV-Dumper — Admin interaction layer
 *
 * Handles every Telegram update coming from the bot admin: content
 * queueing, panel buttons, slash commands and inline confirmations.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

import {
  BTN,
  CB,
  CMD,
  MAX_CAPTION_LEN,
  MAX_TEXT_LEN,
  SEND_INTERVAL_MS,
  TYPE_LABEL,
} from './constants.js';
import { escapeHtml, sendAdminMessage, tgCall } from './telegram.js';
import * as queue from './queue.js';

const WELCOME_TEXT = [
  'سلام! 👋',
  'به ربات صف‌کننده محتوا خوش آمدید.',
  '',
  'هر عکس، ویدیو یا متنی که بفرستید در صف ذخیره می‌شود و با دکمه «🚀 ارسال تمام محتواها به کانال» به‌صورت زمان‌بندی‌شده و با فاصله ۱۰ ثانیه‌ای به کانال ارسال خواهد شد.',
  '',
  'فهرست دستورات: /help',
].join('\n');

const HELP_TEXT = [
  '📚 <b>راهنمای ربات</b>',
  '',
  '<b>دکمه‌های پنل:</b>',
  `• ${BTN.FLUSH} — شروع ارسال صف به کانال`,
  `• ${BTN.STOP} — توقف پردازش (محتواها در صف می‌مانند)`,
  `• ${BTN.CLEAR} — حذف همه محتواهای در انتظار`,
  `• ${BTN.STATS} — وضعیت سیستم و آمار ارسال`,
  `• ${BTN.PREVIEW} — ۵ محتوای آخر صف`,
  `• ${BTN.ERRORS} — مدیریت ارسال‌های ناموفق`,
  `• ${BTN.POWER} — کلید اصلی سیستم`,
  '',
  '<b>دستورات:</b>',
  '/now — شروع ارسال صف',
  '/stop — توقف ارسال',
  '/stats — آمار',
  '/preview — پیش‌نمایش صف',
  '/errors — خطاهای ارسال',
  '/clear — پاکسازی صف',
  '',
  '💡 عکس‌های یک آلبوم به‌صورت گروهی ارسال می‌شوند.',
].join('\n');

/** Reply keyboard shown to the admin. */
export function adminKeyboard() {
  return JSON.stringify({
    keyboard: [
      [{ text: BTN.FLUSH }, { text: BTN.STOP }],
      [{ text: BTN.CLEAR }, { text: BTN.STATS }],
      [{ text: BTN.PREVIEW }, { text: BTN.ERRORS }],
      [{ text: BTN.POWER }],
    ],
    resize_keyboard: true,
  });
}

/**
 * Entry point for all updates. Never throws: internal failures are
 * logged and reported to the admin with escaped content.
 */
export async function handleUpdate(env, update) {
  try {
    if (update.callback_query) {
      await handleCallbackQuery(env, update.callback_query);
    } else if (update.message) {
      await handleAdminMessage(env, update.message);
    }
  } catch (error) {
    console.error('handleUpdate failed:', error);
    await sendAdminMessage(
      env,
      `🚨 خطای داخلی: <code>${escapeHtml(String((error && error.message) || error))}</code>`
    ).catch(() => {});
  }
}

function isAdmin(env, from) {
  return Boolean(from) && String(from.id) === String(env.ADMIN_ID);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function handleAdminMessage(env, message) {
  if (!isAdmin(env, message.from)) return;

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const botStatus = await queue.getSetting(env, 'bot_status', 'on');

  // Master switch: while the system is off, only these inputs are accepted.
  if (botStatus === 'off' && text !== BTN.POWER && text !== CMD.START && text !== CMD.HELP) {
    await sendAdminMessage(env, '🔴 سیستم خاموش است. ابتدا آن را روشن کنید.', adminKeyboard());
    return;
  }

  // Content queueing — photos, videos (including albums) and plain text.
  if (message.photo) {
    const fileId = message.photo[message.photo.length - 1].file_id;
    await enqueueContent(env, 'photo', fileId, message.caption || '', message.media_group_id || null);
    return;
  }
  if (message.video) {
    await enqueueContent(env, 'video', message.video.file_id, message.caption || '', message.media_group_id || null);
    return;
  }

  // Panel buttons and slash commands.
  switch (text) {
    case CMD.START:
      return sendAdminMessage(env, WELCOME_TEXT, adminKeyboard());
    case CMD.HELP:
      return sendAdminMessage(env, HELP_TEXT, adminKeyboard());
    case BTN.FLUSH:
    case CMD.NOW:
      return startFlush(env);
    case BTN.STOP:
    case CMD.STOP:
      return stopFlush(env);
    case BTN.CLEAR:
    case CMD.CLEAR:
      return askClearQueue(env);
    case BTN.STATS:
    case CMD.STATS:
      return sendStats(env);
    case BTN.PREVIEW:
    case CMD.PREVIEW:
      return sendPreview(env);
    case BTN.ERRORS:
    case CMD.ERRORS:
      return sendDeadLetterList(env);
    case BTN.POWER:
      return togglePower(env);
  }

  if (text.startsWith('/')) {
    await sendAdminMessage(env, 'دستور ناشناخته است. فهرست دستورات را با /help ببینید.', adminKeyboard());
    return;
  }

  // Any other text becomes a queued post.
  await enqueueContent(env, 'text', text, '', null);
}

/** Queue an item and acknowledge it with its position plus size warnings. */
async function enqueueContent(env, type, content, caption, mediaGroupId) {
  const position = await queue.enqueue(env, type, content, caption, mediaGroupId);
  const lines = [`✅ ${TYPE_LABEL[type]} به صف اضافه شد (ردیف ${position}).`];

  if (type === 'text' && content.length > MAX_TEXT_LEN) {
    lines.push(`⚠️ طول متن ${content.length} کاراکتر است؛ تلگرام حداکثر ${MAX_TEXT_LEN} کاراکتر را می‌پذیرد.`);
  }
  if (type !== 'text' && caption.length > MAX_CAPTION_LEN) {
    lines.push(`⚠️ طول کپشن ${caption.length} کاراکتر است؛ تلگرام حداکثر ${MAX_CAPTION_LEN} کاراکتر را می‌پذیرد.`);
  }

  await sendAdminMessage(env, lines.join('\n'), adminKeyboard());
}

// ---------------------------------------------------------------------------
// Panel actions
// ---------------------------------------------------------------------------

/** Enable flushing; the cron processor picks it up on its next tick. */
async function startFlush(env) {
  const pending = await queue.pendingCount(env);
  if (pending === 0) {
    await sendAdminMessage(env, '📭 صف خالی است؛ محتوایی برای ارسال وجود ندارد.', adminKeyboard());
    return;
  }

  await queue.setSetting(env, 'flush_enabled', 'on');
  const minutes = Math.max(1, Math.ceil((pending * SEND_INTERVAL_MS) / 60000));
  await sendAdminMessage(
    env,
    [
      `⏳ ارسال ${pending} محتوا آغاز شد.`,
      `پردازش به‌صورت زمان‌بندی‌شده انجام می‌شود و حدود ${minutes} دقیقه طول می‌کشد.`,
      'در پایان، گزارش کامل برایتان ارسال خواهد شد.',
      '',
      'ℹ️ هر زمان با دکمه «⏹ توقف ارسال صف» می‌توانید متوقف کنید.',
    ].join('\n'),
    adminKeyboard()
  );
}

async function stopFlush(env) {
  await queue.setSetting(env, 'flush_enabled', 'off');
  await sendAdminMessage(env, '⏹ پردازش صف متوقف شد. محتواهای باقی‌مانده در صف می‌مانند.', adminKeyboard());
}

async function askClearQueue(env) {
  await sendAdminMessage(env, '🗑 آیا از پاکسازی کل صف مطمئن هستید؟ این عملیات قابل بازگشت نیست.', {
    inline_keyboard: [
      [
        { text: '✅ بله، پاکسازی کن', callback_data: CB.CONFIRM_CLEAR },
        { text: '❌ انصراف', callback_data: CB.CANCEL_CLEAR },
      ],
    ],
  });
}

async function sendStats(env) {
  const [s, botStatus, flush] = await Promise.all([
    queue.stats(env),
    queue.getSetting(env, 'bot_status', 'on'),
    queue.getSetting(env, 'flush_enabled', 'off'),
  ]);

  const lines = [
    '📊 <b>آمار ربات</b>',
    '',
    `🔌 وضعیت سیستم: ${botStatus === 'on' ? '🟢 روشن' : '🔴 خاموش'}`,
    `⏳ پردازش صف: ${flush === 'on' ? '▶️ فعال' : '⏸ متوقف'}`,
    '',
    `📬 در صف انتظار: <b>${s.pending}</b>`,
    `🔥 خطاهای ثبت‌شده: <b>${s.failed}</b>`,
    `✅ ارسال‌شده در ۲۴ ساعت اخیر: <b>${s.sentToday}</b>`,
    `✅ مجموع ارسال‌ها: <b>${s.sentTotal}</b>`,
  ];
  await sendAdminMessage(env, lines.join('\n'), adminKeyboard());
}

async function sendPreview(env) {
  const items = await queue.previewPending(env, 5);
  if (!items.length) {
    await sendAdminMessage(env, '📭 صف خالی است.', adminKeyboard());
    return;
  }

  const lines = ['👁 <b>۵ محتوای آخر صف</b>', ''];
  items.forEach((item, index) => {
    const snippet = item.caption || (item.type === 'text' ? item.content : '—');
    lines.push(`${index + 1}. ${TYPE_LABEL[item.type] || item.type} — ${escapeHtml(String(snippet).slice(0, 60))}`);
  });

  const remaining = await queue.pendingCount(env);
  if (remaining > items.length) {
    lines.push('', `… و ${remaining - items.length} مورد دیگر`);
  }
  await sendAdminMessage(env, lines.join('\n'), adminKeyboard());
}

async function sendDeadLetterList(env) {
  const [items, total] = await Promise.all([queue.listDeadLetters(env, 5), queue.deadLetterCount(env)]);
  if (!total) {
    await sendAdminMessage(env, '🎉 هیچ خطایی ثبت نشده است.', adminKeyboard());
    return;
  }

  const lines = [`🔥 <b>خطاهای ارسال</b> (${total} مورد)`, ''];
  items.forEach((item, index) => {
    const snippet = item.caption || (item.type === 'text' ? item.content : '—');
    lines.push(
      `${index + 1}. ${TYPE_LABEL[item.type] || item.type} — ${escapeHtml(String(snippet).slice(0, 40))}`,
      `   ↳ ${escapeHtml(String(item.error).slice(0, 80))}`
    );
  });
  if (total > items.length) {
    lines.push('', `… و ${total - items.length} مورد دیگر`);
  }

  await sendAdminMessage(env, lines.join('\n'), {
    inline_keyboard: [
      [{ text: '♻️ بازگردانی همه به صف', callback_data: CB.RESTORE_DLQ }],
      [
        { text: '🧹 پاک کردن خطاها', callback_data: CB.ASK_CLEAR_DLQ },
      ],
    ],
  });
}

async function togglePower(env) {
  const current = await queue.getSetting(env, 'bot_status', 'on');
  const next = current === 'on' ? 'off' : 'on';
  await queue.setSetting(env, 'bot_status', next);
  await sendAdminMessage(env, next === 'on' ? '🟢 سیستم روشن شد.' : '🔴 سیستم خاموش شد.', adminKeyboard());
}

// ---------------------------------------------------------------------------
// Inline callbacks
// ---------------------------------------------------------------------------

async function handleCallbackQuery(env, query) {
  if (!isAdmin(env, query.from)) {
    await tgCall(env, 'answerCallbackQuery', { callback_query_id: query.id, text: 'دسترسی ندارید.' });
    return;
  }

  const chatId = query.message && query.message.chat ? query.message.chat.id : null;
  const messageId = query.message ? query.message.message_id : null;

  if (query.data === CB.ASK_CLEAR_DLQ) {
    await tgCall(env, 'answerCallbackQuery', { callback_query_id: query.id });
    await tgCall(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '🧹 همه خطاهای ثبت‌شده پاک شوند؟ این عملیات قابل بازگشت نیست.',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ بله، پاک کن', callback_data: CB.CONFIRM_CLEAR_DLQ },
            { text: '❌ انصراف', callback_data: CB.CANCEL_CLEAR_DLQ },
          ],
        ],
      },
    });
    return;
  }

  let text = null;
  switch (query.data) {
    case CB.CONFIRM_CLEAR: {
      const removed = await queue.clearPending(env);
      text = `🗑 ${removed} محتوا از صف حذف شد.`;
      break;
    }
    case CB.CANCEL_CLEAR:
      text = 'انصراف داده شد؛ صف دست‌نخورده باقی ماند.';
      break;
    case CB.RESTORE_DLQ: {
      const restored = await queue.restoreDeadLetters(env);
      text = restored > 0 ? `♻️ ${restored} مورد به صف ارسال بازگردانده شد.` : 'لیست خطاها خالی است.';
      break;
    }
    case CB.CONFIRM_CLEAR_DLQ: {
      const removed = await queue.clearDeadLetters(env);
      text = `🧹 ${removed} خطا پاک شد.`;
      break;
    }
    case CB.CANCEL_CLEAR_DLQ:
      text = 'انصراف داده شد.';
      break;
    default:
      await tgCall(env, 'answerCallbackQuery', { callback_query_id: query.id });
      return;
  }

  await tgCall(env, 'answerCallbackQuery', { callback_query_id: query.id });
  await finalizeCallback(env, chatId, messageId, text);
}

/** Edit the confirmation message in place; fall back to a fresh message. */
async function finalizeCallback(env, chatId, messageId, text) {
  if (!chatId || !messageId) {
    await sendAdminMessage(env, text);
    return;
  }
  const edited = await tgCall(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text });
  if (!edited.ok) {
    await sendAdminMessage(env, text);
  }
}
