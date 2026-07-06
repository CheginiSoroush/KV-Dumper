
export default {
  async fetch(request, env) {
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
          await handleAdminCommand(env, update.message);
        }
      } catch (error) {
        await sendLogToAdmin(env, `🚨 خطا در وب‌هوک:\n${error.message}`);
      }
      return new Response('OK', { status: 200 });
    }

    return new Response('Unsplash Bot is running...');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledPost(env));
  }
};

// ----------------- زمان‌بندی خودکار -----------------
async function handleScheduledPost(env) {
  try {
    const statusRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'bot_status'").first();
    if (statusRes && statusRes.value === 'off') return;

    await sendPhotosToChannel(env);
  } catch (error) {
    await sendLogToAdmin(env, `🚨 خطا در ارسال زمان‌بندی شده:\n${error.message}`);
  }
}

// ----------------- دریافت و ارسال عکس‌ها -----------------
async function sendPhotosToChannel(env) {
  try {
    // انتخاب یک دسته‌بندی تصادفی از دیتابیس
    const catRes = await env.db1.prepare("SELECT name FROM categories ORDER BY RANDOM() LIMIT 1").first();
    if (!catRes) {
      await sendLogToAdmin(env, "❌ هیچ دسته‌بندی‌ای در دیتابیس وجود ندارد!");
      return false;
    }
    
    const category = catRes.name;
    const response = await fetch(`https://api.unsplash.com/photos/random?count=2&query=${encodeURIComponent(category)}`, {
      headers: { Authorization: `Client-ID ${env.UNSPLASH_KEY}` }
    });

    if (!response.ok) {
      const errData = await response.json();
      await sendLogToAdmin(env, `🚨 خطای Unsplash API:\n${errData.errors ? errData.errors[0] : response.statusText}`);
      return false;
    }

    const data = await response.json();
    if (!data || data.length < 2) return false;

    // ساخت هشتگ مناسب (حذف فاصله‌ها و کاراکترهای اضافی)
    const hashtag = `#${category.replace(/ & /g, '').replace(/ /g, '')}`;
    
    const media = [
      { type: "photo", media: data[0].urls.regular, caption: hashtag },
      { type: "photo", media: data[1].urls.regular }
    ];

    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMediaGroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.CHANNEL_ID,
        media: media
      })
    });

    if (res.ok) {
      await sendLogToAdmin(env, `📸 ۲ عکس با دسته‌بندی ${hashtag} به کانال ارسال شد.`);
      return true;
    } else {
      const errData = await res.json();
      await sendLogToAdmin(env, `🚨 خطای تلگرام در ارسال عکس:\n${errData.description}`);
      return false;
    }
  } catch (error) {
    await sendLogToAdmin(env, `🚨 خطا در دریافت/ارسال عکس:\n${error.message}`);
    return false;
  }
}

// ----------------- پنل ادمین -----------------
function getAdminPanel() {
  return JSON.stringify({
    keyboard: [
      [{ text: "📸 ارسال فوری عکس" }, { text: "🖼 مدیریت دسته‌بندی‌ها" }],
      [{ text: "📊 آمار و وضعیت" }, { text: "🔌 روشن/خاموش کردن سیستم" }]
    ],
    resize_keyboard: true
  });
}

function getCancelPanel() {
  return JSON.stringify({ keyboard: [[{ text: "انصراف" }]], resize_keyboard: true });
}

async function setAdminState(env, state) {
  await env.db1.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_state', ?)").bind(state).run();
}

async function handleAdminCommand(env, message) {
  const chatId = message.chat.id;
  const text = message.text;
  let responseText = "";
  let replyMarkup = getAdminPanel();

  try {
    const stateRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'admin_state'").first();
    const adminState = stateRes ? stateRes.value : null;

    if (adminState && text !== 'انصراف') {
      if (adminState === 'awaiting_add_cat') {
        await env.db1.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").bind(text.trim()).run();
        await setAdminState(env, '');
        responseText = `✅ دسته‌بندی «${text.trim()}» اضافه شد.`;
      } else if (adminState === 'awaiting_del_cat') {
        const res = await env.db1.prepare("DELETE FROM categories WHERE name = ?").bind(text.trim()).run();
        await setAdminState(env, '');
        responseText = res.meta.changes > 0 ? `🗑 دسته‌بندی «${text.trim()}» حذف شد.` : `❌ دسته‌بندی یافت نشد.`;
      }
      if (responseText !== "") return await sendTelegramMessage(env, chatId, responseText, replyMarkup);
    }

    if (text === '/start' || text === 'انصراف') {
      await setAdminState(env, '');
      responseText = (text === '/start') ? "به ربات ارسال عکس آنسپلش خوش آمدید!" : "عملیات لغو شد.";
    } 
    else if (text === '📸 ارسال فوری عکس' || text === '/now') {
      await sendTelegramMessage(env, chatId, "⏳ در حال دریافت عکس از Unsplash...", getAdminPanel());
      const success = await sendPhotosToChannel(env);
      responseText = success ? "✅ عکس‌ها با موفقیت به کانال ارسال شد." : "🚨 ارسال ناموفق بود. لاگ‌ها را بررسی کنید.";
    }
    else if (text === '🖼 مدیریت دسته‌بندی‌ها') {
      replyMarkup = JSON.stringify({
        keyboard: [
          [{ text: "➕ افزودن دسته‌بندی" }, { text: "➖ حذف دسته‌بندی" }],
          [{ text: "📋 لیست دسته‌بندی‌ها" }, { text: "🔙 بازگشت به منو" }]
        ],
        resize_keyboard: true
      });
      responseText = "مدیریت دسته‌بندی‌های Unsplash:";
    }
    else if (text === '➕ افزودن دسته‌بندی') {
      await setAdminState(env, 'awaiting_add_cat');
      responseText = "لطفاً نام دسته‌بندی جدید را به انگلیسی ارسال کنید:";
      replyMarkup = getCancelPanel();
    }
    else if (text === '➖ حذف دسته‌بندی') {
      await setAdminState(env, 'awaiting_del_cat');
      responseText = "لطفاً نام دسته‌بندی که می‌خواهید حذف کنید را ارسال کنید:";
      replyMarkup = getCancelPanel();
    }
    else if (text === '📋 لیست دسته‌بندی‌ها') {
      const cats = await env.db1.prepare("SELECT name FROM categories").all();
      if (!cats.results || cats.results.length === 0) {
        responseText = "هیچ دسته‌بندی‌ای ثبت نشده است.";
      } else {
        let list = "📋 دسته‌بندی‌های موجود:\n\n";
        cats.results.forEach((c, i) => list += `${i + 1}- ${c.name}\n`);
        responseText = list;
      }
    }
    else if (text === '📊 آمار و وضعیت') {
      const cats = await env.db1.prepare("SELECT COUNT(*) as count FROM categories").first();
      const statusRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'bot_status'").first();
      const status = statusRes ? statusRes.value : 'on';
      responseText = `📊 آمار ربات:\n\n🖼 تعداد دسته‌بندی‌ها: ${cats ? cats.count : 0}\n\nوضعیت سیستم: ${status === 'on' ? '🟢 روشن' : '🔴 خاموش'}`;
    }
    else if (text === '🔌 روشن/خاموش کردن سیستم') {
      const statusRes = await env.db1.prepare("SELECT value FROM settings WHERE key = 'bot_status'").first();
      let currentStatus = statusRes ? statusRes.value : 'on';
      let newStatus = currentStatus === 'on' ? 'off' : 'on';
      await env.db1.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('bot_status', ?)").bind(newStatus).run();
      responseText = newStatus === 'on' ? "🟢 سیستم روشن شد. ارسال خودکار فعال است." : "🔴 سیستم خاموش شد.";
    }
    else if (text === '🔙 بازگشت به منو') {
      responseText = "به منوی اصلی بازگشتید.";
    }
    else {
      responseText = "دستور نامعتبر است. از دکمه‌های پنل استفاده کنید.";
    }

    await sendTelegramMessage(env, chatId, responseText, replyMarkup);
  } catch (error) {
    await sendTelegramMessage(env, chatId, `🚨 خطا:\n${error.message}`, getAdminPanel());
    await sendLogToAdmin(env, `🚨 خطا در دستور ادمین: ${error.message}`);
  }
}

// ----------------- توابع کمکی -----------------
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
