
# 📥 KV-Dumper - Telegram Content Queue Bot

یک ربات تلگرام Serverless برای مدیریت، صف‌بندی و ارسال زمان‌بندی شده محتوا به کانال‌ها. این ربات به ادمین اجازه می‌دهد عکس، ویدیو و متن را در صف (Queue) ذخیره کند و سپس با یک کلیک، تمام آن‌ها را با تاخیر ۱۰ ثانیه‌ای به کانال ارسال کند تا از محدودیت‌های تلگرام جلوگیری شود.
https://imsoroush.ir/computer/Other_computer/kv-dumper
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot_API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/)

---

## ✨ ویژگی‌های اصلی

- 📬 **سیستم صف‌بندی (Queue):** ذخیره پیام‌ها در دیتابیس D1 تا زمانی که ادمین دستور ارسال را بدهد.
- ⏱ **ارسال با تاخیر:** ارسال محتواها با فاصله زمانی ۱۰ ثانیه برای جلوگیری از بن شدن ربات.
- 🖼 **پشتیبانی از فرمت‌ها:** صف‌بندی عکس، ویدیو و متن (با کپشن).
- ⚡ **پردازش پس‌زمینه:** استفاده از `ctx.waitUntil` کلودفلر برای پردازش صف طولانی بدون تایم‌اوت.
- 📊 **پنل مدیریت:** مشاهده آمار صف، پاکسازی صف، و روشن/خاموش کردن سیستم.

---

## 🚀 راه‌اندازی و دیپلوی

1. **کلون کردن پروژه:**
```bash
git clone https://github.com/USERNAME/KV-Dumper.git
cd KV-Dumper
```

2. **نصب Wrangler و لاگین:**
```bash
npm install -g wrangler
wrangler login
```

3. **ساخت دیتابیس D1:**
```bash
wrangler d1 create kv_dumper_db
```
آیدی دریافتی را در فایل `wrangler.toml.example` قرار داده و نام آن را به `wrangler.toml` تغییر دهید.

4. **ایجاد جداول دیتابیس:**
```bash
wrangler d1 execute kv_dumper_db --file=./schema.sql
```

5. **تنظیم متغیرهای محیطی (Secrets):**
```bash
wrangler secret put BOT_TOKEN      # توکن ربات تلگرام
wrangler secret put ADMIN_ID       # آیدی عددی ادمین
wrangler secret put CHANNEL_ID     # آیدی کانال مقصد (مثال: -1001234567890)
```

6. **دیپلوی کردن:**
```bash
wrangler deploy
```

7. **راه‌اندازی وب‌هوک:**
آدرس زیر را در مرورگر باز کنید:
`https://your-worker-name.your-subdomain.workers.dev/setwebhook`

---

## 🎯 نحوه استفاده

1. در ربات دستور `/start` را بزنید.
2. عکس‌ها، ویدیوها و متن‌های خود را بفرستید تا در صف ذخیره شوند.
3. ربات را در کانال خود ادمین کنید.
4. روی دکمه «🚀 ارسال تمام محتواها به کانال» بزنید.
5. ربات شروع به ارسال محتواها با تاخیر ۱۰ ثانیه‌ای می‌کند و در پایان لاگ ارسال شده و ناموفق را به شما می‌دهد.

---

## 📜 مجوز
این پروژه تحت مجوز MIT منتشر شده است.
