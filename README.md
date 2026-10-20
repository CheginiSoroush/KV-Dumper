
# 📥 KV-Dumper — ربات صف‌بندی محتوا برای تلگرام

[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot_API-2CA5E0?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

ربات Serverless برای ذخیره، صف‌بندی و ارسال زمان‌بندی‌شده محتوا به کانال تلگرام — ساخته‌شده برای **Cloudflare Workers** با دیتابیس **D1** و **Cron Triggers**.

🔗 مستندات کامل: https://imsoroush.ir/computer/Other_computer/kv-dumper

---

## ✨ ویژگی‌ها

- 📬 **صف‌بندی محتوا** — ذخیره عکس، ویدیو و متن در دیتابیس D1 تا زمان دستور ارسال
- 🖼 **پشتیبانی کامل از آلبوم** — عکس‌های یک آلبوم به‌صورت گروهی با `sendMediaGroup` ارسال می‌شوند
- ⏱ **ارسال ضد فلود** — فاصله ۱۰ ثانیه‌ای بین پست‌ها با احترام کامل به `retry_after` تلگرام
- ♻️ **مدیریت خطا** — تلاش مجدد خودکار برای خطاهای موقت و جدول خطاها (Dead Letter) برای خطاهای دائمی با قابلیت بازگردانی
- 🏛 **معماری Cron محور** — بدون خواب طولانی داخل `waitUntil`؛ پایدار حتی برای صف‌های چندصدتایی
- 🔐 **اعتبارسنجی وب‌هوک** — فقط تلگرام با `secret_token` می‌تواند ربات را فراخوانی کند
- 📊 **پنل مدیریت کامل** — آمار ارسال، پیش‌نمایش صف، مدیریت خطاها و توقف اضطراری پردازش

---

## 🏛 معماری

```text
Telegram ──webhook──▶ Worker (fetch)  ──▶ صف‌بندی در D1
                         ▲
Cron (هر دقیقه) ──▶ Worker (scheduled) ──▶ پردازش دسته‌ای صف
```

دکمه «ارسال تمام محتواها» فقط یک پرچم (`flush_enabled`) در دیتابیس روشن می‌کند. پردازش واقعی هر دقیقه توسط Cron Trigger انجام می‌شود؛ یک **قفل زمان‌دار** از پردازش موازی جلوگیری می‌کند، آیتم‌ها به‌صورت **اتمیک** (`UPDATE ... RETURNING`) برمی‌گردند و پس از اتمام بودجه زمانی، تیک بعدی کار را ادامه می‌دهد. در نتیجه هیچ محتوایی وسط کار گم نمی‌شود و ارسال تکراری رخ نمی‌دهد.

---

## 🚀 راه‌اندازی (نصب تازه)

1. **کلون و نصب:**
```bash
git clone https://github.com/CheginiSoroush/KV-Dumper.git
cd KV-Dumper
npm install
```

2. **ساخت دیتابیس D1:**
```bash
npx wrangler d1 create kv-dumper-db
```

3. **تنظیم کانفیگ:**
```bash
cp wrangler.toml.example wrangler.toml
```
سپس `database_id` دریافتی را در `wrangler.toml` قرار دهید.

4. **ایجاد جداول:**
```bash
npm run db:init
```

5. **تنظیم Secrets:**
```bash
npx wrangler secret put BOT_TOKEN        # توکن ربات از @BotFather
npx wrangler secret put ADMIN_ID         # آیدی عددی ادمین (@userinfobot)
npx wrangler secret put CHANNEL_ID       # کانال مقصد (مثال: -1001234567890)
npx wrangler secret put WEBHOOK_SECRET   # openssl rand -hex 32
```

6. **دیپلوی:**
```bash
npm run deploy
```

7. **ثبت وب‌هوک** (آدرس زیر را با secret خود باز کنید):
```
https://<worker-name>.<subdomain>.workers.dev/setwebhook?secret=<WEBHOOK_SECRET>
```

---

## ⬆️ ارتقا از نسخه ۱ به ۲

```bash
git pull origin main
npm install
```

1. **به‌روزرسانی `wrangler.toml`** — دو تغییر لازم است:
   - `main = "index.js"` را به `main = "src/index.js"` تغییر دهید
   - بخش تریگر را اضافه کنید:
     ```toml
     [triggers]
     crons = ["* * * * *"]
     ```

2. **ارتقای دیتابیس** (بدون از دست رفتن داده):
```bash
npm run db:upgrade
```

3. **تنظیم secret جدید و دیپلوی مجدد:**
```bash
npx wrangler secret put WEBHOOK_SECRET   # openssl rand -hex 32
npm run deploy
```

4. **ثبت مجدد وب‌هوک** (برای فعال شدن secret token):
```
https://<worker-url>/setwebhook?secret=<WEBHOOK_SECRET>
```

---

## 🔑 متغیرهای محیطی (Secrets)

| Secret | مثال | توضیح |
|---|---|---|
| `BOT_TOKEN` | `123456:ABC-DEF...` | توکن ربات از [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | `123456789` | آیدی عددی ادمین (فقط همین کاربر به ربات دسترسی دارد) |
| `CHANNEL_ID` | `-1001234567890` یا `@username` | کانال مقصد؛ ربات باید ادمین کانال باشد |
| `WEBHOOK_SECRET` | `openssl rand -hex 32` | توکن مشترک بین تلگرام و Worker برای اعتبارسنجی وب‌هوک |

---

## 🎯 نحوه استفاده

1. به ربات `/start` بدهید تا پنل نمایش داده شود.
2. عکس، ویدیو یا متن بفرستید تا در صف ذخیره شوند (عکس‌های یک آلبوم خودکار گروه می‌شوند).
3. روی «🚀 ارسال تمام محتواها به کانال» بزنید؛ پردازش زمان‌بندی‌شده آغاز می‌شود و در پایان گزارش کامل می‌گیرید.

### دکمه‌ها و دستورات

| کنش | دکمه | دستور |
|---|---|---|
| شروع ارسال صف | 🚀 ارسال تمام محتواها به کانال | `/now` |
| توقف پردازش | ⏹ توقف ارسال صف | `/stop` |
| پاکسازی صف (با تأیید) | 🗑 پاکسازی صف | `/clear` |
| آمار و وضعیت | 📊 آمار صف | `/stats` |
| پیش‌نمایش ۵ مورد آخر | 👁 نمایش آخرین محتواهای صف | `/preview` |
| مدیریت خطاها | 🔥 خطاهای ارسال | `/errors` |
| کلید اصلی سیستم | 🔌 روشن/خاموش کردن سیستم | — |

---

## ⚙️ تنظیمات پردازش صف

تمام مقادیر در `src/constants.js` جمع‌آوری شده‌اند:

| ثابت | پیش‌فرض | توضیح |
|---|---|---|
| `SEND_INTERVAL_MS` | ۱۰ ثانیه | فاصله بین ارسال پست‌ها به کانال |
| `MAX_RETRIES` | ۳ | حداکثر تلاش مجدد برای خطاهای موقت |
| `PROCESSOR_BUDGET_MS` | ۶۰ ثانیه | بودجه زمانی هر تیک Cron |
| `LOCK_LEASE_MS` | ۳ دقیقه | مدت اعتبار قفل پردازش |
| `STALE_CLAIM_MS` | ۵ دقیقه | آستانه بازیابی آیتم‌های نیمه‌کاره |
| `ALBUM_MAX` | ۱۰ | سقف مجاز آلبوم تلگرام |

---

## 🧰 اسکریپت‌ها

| دستور | کار |
|---|---|
| `npm run dev` | اجرای محلی با wrangler dev |
| `npm run deploy` | دیپلوی روی Cloudflare |
| `npm run tail` | مشاهده زنده لاگ‌ها |
| `npm run db:init` | ساخت جداول (نصب تازه) |
| `npm run db:upgrade` | ارتقای دیتابیس v1 → v2 |

---

## 🤖 دیپلوی خودکار (اختیاری)

وورک‌فلو `.github/workflows/deploy.yml` به‌صورت دستی (`workflow_dispatch`) اجرا می‌شود. برای فعال‌سازی، secret مخزن `CLOUDFLARE_API_TOKEN` را با دسترسی «Workers Scripts: Edit» بسازید. برای دیپلوی خودکار روی push، بلوک `on` وورک‌فلو را مطابق کامنت داخل فایل تغییر دهید.

---

## 📜 مجوز

این پروژه تحت مجوز [MIT](./LICENSE) منتشر شده است.

© CheginiSoroush
