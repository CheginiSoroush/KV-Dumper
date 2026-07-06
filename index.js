export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    if (url.pathname === '/setwebhook') {
      const webhookUrl = `https://${url.hostname}/webhook`;
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
      return new Response(await res.text());
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update.message?.from.id.toString() === env.ADMIN_ID.toString()) {
          // استفاده از ctx.waitUntil تا کلودفلر در حین ارسال صف، ارتباط را قطع نکند
          ctx.waitUntil(handleAdminCommand(env, update.message));
        }
      } catch (error) {
        await sendLogToAdmin(env, `🚨 خطا در وب‌هوک:\n${error.message}`);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('KV Dumper Bot is running...');
  }
};

// ----------------- پنل ادمین -----------------
function getAdminPanel() {
  return JSON.stringify({
    keyboard: [
      [{ text: "🚀 ارسال تمام محتواها به کانال" }, { text: "🗑 پاکسازی صف" }],
      [{ text: "📊 آمار صف" }, { text: "🔌 روشن/خاموش کردن سیستم" }]
    ],
    resize_keyboard: true
  });
}

async function handleAdminCommand(env, message) {
  const chatId = message.chat.id;
  const text = message.text;
  let responseText = "";
  let replyMarkup = getAdminPanel();

  try {
    const statusRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'bot_status'").first();
    const botStatus = statusRes ? statusRes.value : 'on';

    if (botStatus === 'off' && text !== '🔌 روشن/خاموش کردن سیستم') {
      await sendTelegramMessage(env, chatId, "🔴 سیستم خاموش است. ابتدا آن را روشن کنید.", getAdminPanel());
      return;
    }

    // بخش افزودن محتوا به صف (عکس، ویدیو، متن)
    if (message.photo) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      const caption = message.caption || "";
      await env.db1.prepare("INSERT INTO queue (type, content, caption) VALUES ('photo', ?, ?)").bind(fileId, caption).run();
      await sendTelegramMessage(env, chatId, "✅ عکس به صف ارسال اضافه شد.", getAdminPanel());
      return;
    } 
    else if (message.video) {
      const fileId = message.video.file_id;
      const caption = message.caption || "";
      await env.db1.prepare("INSERT INTO queue (type, content, caption) VALUES ('video', ?, ?)").bind(fileId, caption).run();
      await sendTelegramMessage(env, chatId, "✅ ویدیو به صف ارسال اضافه شد.", getAdminPanel());
      return;
    }
    else if (text && !text.startsWith('/') && text !== '🚀 ارسال تمام محتواها به کانال' && text !== '🗑 پاکسازی صف' && text !== '📊 آمار صف' && text !== '🔌 روشن/خاموش کردن سیستم') {
      await env.db1.prepare("INSERT INTO queue (type, content, caption) VALUES ('text', ?, '')").bind(text).run();
      await sendTelegramMessage(env, chatId, "✅ متن به صف ارسال اضافه شد.", getAdminPanel());
      return;
    }

    // بخش دستورات پنل
    if (text === '/start') {
      responseText = "به ربات صف‌کننده محتوا خوش آمدید!\nهر عکس، ویدیو یا متنی که بفرستید در صف ذخیره می‌شود. روی «ارسال تمام محتواها» بزنید تا با تاخیر ۱۰ ثانیه‌ای به کانال بروند.";
    } 
    else if (text === '🚀 ارسال تمام محتواها به کانال' || text === '/now') {
      await sendTelegramMessage(env, chatId, "⏳ شروع ارسال صف... این عملیات ممکن است طول بکشد. شما می‌توانید این صفحه را ببندید.", getAdminPanel());
      await processQueue(env);
      return;
    }
    else if (text === '🗑 پاکسازی صف' || text === '/clear') {
      await env.db1.prepare("DELETE FROM queue").run();
      responseText = "🗑 صف محتوا با موفقیت خالی شد.";
    }
    else if (text === '📊 آمار صف') {
      const countRes = await env.db1.prepare("SELECT COUNT(*) as count FROM queue").first();
      responseText = `📊 تعداد محتواهای در صف انتظار: ${countRes ? countRes.count : 0} مورد.`;
    }
    else if (text === '🔌 روشن/خاموش کردن سیستم') {
      let newStatus = botStatus === 'on' ? 'off' : 'on';
      await env.db1.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('bot_status', ?)").bind(newStatus).run();
      responseText = newStatus === 'on' ? "🟢 سیستم روشن شد." : "🔴 سیستم خاموش شد.";
    }
    else {
      responseText = "لطفاً یک عکس، ویدیو یا متن بفرستید تا در صف قرار گیرد، یا از دکمه‌های پنل استفاده کنید.";
    }

    await sendTelegramMessage(env, chatId, responseText, replyMarkup);
  } catch (error) {
    await sendTelegramMessage(env, chatId, `🚨 خطا:\n${error.message}`, getAdminPanel());
    await sendLogToAdmin(env, `🚨 خطا در دستور ادمین: ${error.message}`);
  }
}

// ----------------- پردازش صف با تاخیر ۱۰ ثانیه‌ای -----------------
async function processQueue(env) {
  let sentCount = 0;
  let failedCount = 0;

  while (true) {
    const item = await env.db1.prepare("SELECT * FROM queue ORDER BY id LIMIT 1").first();
    if (!item) break; // اگر صف خالی بود، حلقه تمام می‌شود

    let success = false;
    try {
      if (item.type === 'text') {
        success = await sendTelegramContent(env, 'sendMessage', { chat_id: env.CHANNEL_ID, text: item.content });
      } else if (item.type === 'photo') {
        success = await sendTelegramContent(env, 'sendPhoto', { chat_id: env.CHANNEL_ID, photo: item.content, caption: item.caption });
      } else if (item.type === 'video') {
        success = await sendTelegramContent(env, 'sendVideo', { chat_id: env.CHANNEL_ID, video: item.content, caption: item.caption });
      }
    } catch (e) {
      success = false;
    }

    if (success) {
      sentCount++;
    } else {
      failedCount++;
    }

    // حذف آیتم از دیتابیس (چه موفق بود چه ناموفق، تا صف گیر نکند)
    await env.db1.prepare("DELETE FROM queue WHERE id = ?").bind(item.id).run();

    // تاخیر ۱۰ ثانیه‌ای قبل از آیتم بعدی
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  await sendLogToAdmin(env, `✅ پردازش صف به پایان رسید.\n\nارسال موفق: ${sentCount}\nارسال ناموفق: ${failedCount}`);
}

// ----------------- توابع کمکی -----------------
async function sendTelegramContent(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.ok;
}

async function sendTelegramMessage(env, chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text: text, parse_mode: 'HTML' };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendLogToAdmin(env, logText) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.ADMIN_ID, text: logText, parse_mode: 'HTML' })
  });
}
