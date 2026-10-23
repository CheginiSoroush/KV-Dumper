<div align="center">

# 📨 KV-Dumper

**ربات صف‌کننده و ارسال زمان‌بندی‌شدهٔ محتوا برای کانال‌های تلگرام**
**کاملاً Serverless روی Cloudflare Workers + D1**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-blueviolet)](../../releases)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-D1-orange)](https://developers.cloudflare.com/d1/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot_API-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Checks](https://img.shields.io/badge/checks-33%2F33%20passed-brightgreen)](#-صحتسنجی)
[![Deploy](https://github.com/CheginiSoroush/KV-Dumper/actions/workflows/deploy.yml/badge.svg)](../../actions/workflows/deploy.yml)

**[🌐 صفحهٔ پروژه](https://cheginisoroush.github.io/KV-Dumper/)** &nbsp;·&nbsp; [English](README.md) | **فارسی**

</div>

---

KV-Dumper محتوایی که برایتان می‌فرستید (عکس، ویدیو، متن و آلبوم) در صف ذخیره می‌کند و با فشار یک دکمه، آن‌ها را با فاصلهٔ زمانی مطمئن و بدون تداخل به کانال ارسال می‌کند. هیچ سروری وجود ندارد؛ فقط یک Worker رایگان، یک دیتابیس D1 و یک کران‌تریکگر هر یک دقیقه.

> 💡 **بدون هزینه، بدون نگهداری:** پلن رایگان Workers برای استفادهٔ شخصی کاملاً کافی است و همهٔ داده‌ها در D1 باقی می‌مانند — حتی بعد از خطا.

## 📑 فهرست

- [✨ امکانات](#-امکانات)
- [🧱 معماری](#-معماری)
- [🚀 راه‌اندازی سریع](#-راهاندازی-سریع)
- [🔐 متغیرها و Secrets](#-متغیرها-و-secrets)
- [🤖 پنل مدیریت](#-پنل-مدیریت)
- [🗄 دیتابیس](#-دیتابیس)
- [⚙️ تنظیمات پردازش](#️-تنظیمات-پردازش)
- [🌐 نقاط پایانی HTTP](#-نقاط-پایانی-http)
- [🔄 استقرار خودکار (CI/CD)](#-استقرار-خودکار-cicd)
- [⬆️ ارتقا از نسخهٔ ۱ به ۲](#️-ارتقا-از-نسخهٔ-۱-به-۲)
- [🧪 صحت‌سنجی](#-صحتسنجی)
- [🗺 نقشهٔ راه](#-نقشهٔ-راه)
- [📄 لایسنس](#-لایسنس)

## ✨ امکانات

| | قابلیت | توضیح |
|---|---|---|
| 📥 | **صف‌بندی محتوا** | هر عکس، ویدیو یا متنی که برای ربات بفرستید در صف ذخیره می‌شود |
| ⏱ | **ارسال زمان‌بندی‌شده** | پردازشگر Cron با فاصلهٔ ۱۰ ثانیه‌ای بین پست‌ها، ایمن از محدودیت Flood تلگرام |
| 🖼 | **پشتیبانی آلبوم** | اعضای یک `media_group` با `sendMediaGroup` به‌صورت گروهی ارسال می‌شوند |
| 🔐 | **وب‌هوک امن** | اعتبارسنجی هدر `X-Telegram-Bot-Api-Secret-Token`؛ درخواست‌های غریبه رد می‌شوند |
| 🔁 | **تلاش مجدد هوشمند** | خطاهای موقت تا ۳ بار تکرار می‌شوند؛ `retry_after` مربوط به 429 رعایت می‌شود |
| 🔥 | **Dead Letter Queue** | خطاهای دائمی با ذخیرهٔ علت، برای بازبینی و بازگردانی ادمین نگه داشته می‌شوند |
| 🚫 | **بدون ارسال تکراری** | claim اتمیک با `UPDATE ... RETURNING` — هر آیتم فقط به یک پردازشگر می‌رسد |
| 📊 | **آمار و پیش‌نمایش** | صف انتظار، خطاها، ارسال امروز و کل + پیش‌نمایش ۵ محتوای آخر |
| ⏹ | **کنترل کامل** | شروع/توقف ارسال، پاکسازی با تأیید inline، کلید اصلی روشن/خاموش |
| 🧩 | **معماری ماژولار** | ۶ ماژول متمرکز با منبع واحد برای تنظیمات و لیبل‌ها |

## 🧱 معماری

```text
                    ┌─────────────────────────────────────────────┐
                    │              Cloudflare Worker              │
  ادمین تلگرام ────▶ │  /webhook ──▶ handlers.js ─┐                │
                    │                            ├──▶ queue.js ──▶ D1
  Cron (هر دقیقه) ▶ │  scheduled ──▶ processor ──┤       ▲         │
                    │                    │       └──▶ settings   │
                    │                    ▼                 │       │
                    │              telegram.js ────▶ Bot API ──▶ 📣 کانال
                    └─────────────────────────────────────────────┘
```

| ماژول | مسئولیت |
|---|---|
| `src/index.js` | ورودی Worker: مسیریابی `fetch` و `scheduled` (Cron) |
| `src/handlers.js` | تعامل ادمین: صف‌بندی محتوا، دکمه‌های پنل، تأییدهای inline |
| `src/processor.js` | پردازشگر دسته‌ای صف: قفل، claim، ارسال، retry، گزارش نهایی |
| `src/queue.js` | لایهٔ دسترسی داده: claim اتمیک، dead-letter، آمار |
| `src/telegram.js` | کلاینت Bot API با گزارش خطای ساخت‌یافته (شامل `retry_after`) |
| `src/constants.js` | منبع واحد: لیبل دکمه‌ها، دستورات، تنظیمات پردازش |

**سیاست خطا:** خطاهای موقت (قطع شبکه، 5xx، 429) بعد از backoff دوباره تلاش می‌شوند؛ خطاهای دائمی (4xx) یا اتمام سهم retry به جدول `dead_letter` می‌روند و هیچ داده‌ای گم نمی‌شود. اگر یک پردازشگر وسط کار بمیرد، آیتم‌های نیمه‌کاره بعد از `STALE_CLAIM_MS` خودکار بازیابی می‌شوند.

## 🚀 راه‌اندازی سریع

**پیش‌نیازها:** Node.js 18+، یک بات تلگرام ([@BotFather](https://t.me/BotFather))، اکانت Cloudflare.

```bash
# ۱) کلون و نصب
git clone https://github.com/CheginiSoroush/KV-Dumper.git
cd KV-Dumper && npm install

# ۲) ساخت دیتابیس D1 (شناسه‌اش را کپی کنید)
npx wrangler d1 create kv-dumper-db

# ۳) ساخت فایل تنظیمات و قرار دادن database_id
cp wrangler.toml.example wrangler.toml
#    فایل را باز کنید و <YOUR_D1_DATABASE_ID> را جایگزین کنید

# ۴) ساخت جداول
npm run db:init

# ۵) تنظیم Secrets
npx wrangler secret put BOT_TOKEN        # توکن @BotFather
npx wrangler secret put ADMIN_ID         # شناسهٔ عددی شما (@userinfobot)
npx wrangler secret put CHANNEL_ID       # مثلاً @mychannel
npx wrangler secret put WEBHOOK_SECRET   # با: openssl rand -hex 32 بسازید

# ۶) انتشار
npm run deploy
```

در نهایت وب‌هوک را ثبت کنید — این آدرس را در مرورگر باز کنید:

```text
https://kv-dumper.<your-subdomain>.workers.dev/setwebhook?secret=<WEBHOOK_SECRET>
```

به بات پیام `/start` بدهید؛ پنل مدیریت با دکمه‌ها باز می‌شود. تمام! 🎉

## 🔐 متغیرها و Secrets

| نام | نوع | توضیح |
|---|---|---|
| `BOT_TOKEN` | Secret | توکن بات از [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | Secret | شناسهٔ عددی ادمین — فقط همین چت به ربات دسترسی دارد |
| `CHANNEL_ID` | Secret | مقصد ارسال؛ `@username` کانال یا شناسهٔ عددی |
| `WEBHOOK_SECRET` | Secret | کلید مشترک وب‌هوک؛ تولید با `openssl rand -hex 32` |
| `db1` | Binding | دیتابیس D1 (در `wrangler.toml`) |

> ⚠️ **نکتهٔ امنیتی:** ادمین بودن فقط با تطابق `ADMIN_ID` چک می‌شود و وب‌هوک بدون هدر secret پاسخ `403` می‌دهد. ربات پیام‌های کانال را بدون `parse_mode` می‌فرستد تا محتوای کاربر هرگز به‌عنوان HTML تفسیر نشود.

## 🤖 پنل مدیریت

| دکمه | عملکرد |
|---|---|
| 🚀 ارسال تمام محتواها به کانال | شروع پردازش صف با گزارش زمان تقریبی |
| ⏹ توقف ارسال صف | توقف پردازش؛ محتواها در صف می‌مانند |
| 🗑 پاکسازی صف | حذف همهٔ موارد در انتظار — با تأیید inline |
| 📊 آمار صف | وضعیت سیستم + صف، خطا، ارسال ۲۴ ساعت و کل |
| 👁 نمایش آخرین محتواهای صف | پیش‌نمایش ۵ محتوای آخر |
| 🔥 خطاهای ارسال | لیست خطاها با علت + بازگردانی گروهی/پاکسازی با تأیید |
| 🔌 روشن/خاموش کردن سیستم | کلید اصلی؛ در حالت خاموش فقط این دکمه و `/help` کار می‌کند |

**دستورات:** `/now` · `/stop` · `/stats` · `/preview` · `/errors` · `/clear` · `/help`

هنگام صف‌بندی، اگر متن بیش از ۴۰۹۶ یا کپشن بیش از ۱۰۲۴ کاراکتر باشد، ربات قبل از ارسال به کانال هشدار می‌دهد.

## 🗄 دیتابیس

| جدول | نقش |
|---|---|
| `queue` | صف محتوا با وضعیت (`pending` / `sending`)، شمارندهٔ retry، `media_group_id` و مُهر زمانی claim |
| `dead_letter` | موارد شکست‌خوردهٔ دائمی به‌همراه علت خطا |
| `sent_log` | تاریخچهٔ ارسال‌ها (مبنای آمار «امروز» و «کل») |
| `settings` | کلید/مقدار برای پرچم‌های اجرا (`bot_status`, `flush_enabled`, `lock_until`) |

نصب تازه: `schema.sql` — ارتقای v1→v2 بدون از دست رفتن داده: `migrations/v1-to-v2.sql`

## ⚙️ تنظیمات پردازش

همه در `src/constants.js` — بدون نیاز به دست‌زدن به منطق:

| ثابت | پیش‌فرض | توضیح |
|---|---|---|
| `SEND_INTERVAL_MS` | ۱۰ ثانیه | فاصلهٔ بین پست‌های کانال |
| `RETRY_BACKOFF_MS` | ۵ ثانیه | مکث بعد از خطای موقت |
| `MAX_RETRIES` | ۳ | سهم تلاش مجدد قبل از dead-letter |
| `ALBUM_MAX` | ۱۰ | حداکثر اعضای آلبوم (محدودیت تلگرام) |
| `PROCESSOR_BUDGET_MS` | ۶۰ ثانیه | بودجهٔ زمانی هر تیک Cron |
| `LOCK_LEASE_MS` | ۳ دقیقه | اجارهٔ قفل پردازش (باید از بودجه بیشتر باشد) |
| `STALE_CLAIM_MS` | ۵ دقیقه | بازیابی آیتم‌های رهاشده در حالت `sending` |

## 🌐 نقاط پایانی HTTP

| مسیر | متد | محافظت | کارکرد |
|---|---|---|---|
| `/webhook` | `POST` | هدر `X-Telegram-Bot-Api-Secret-Token` | دریافت آپدیت‌های تلگرام |
| `/setwebhook?secret=…` | `GET` | پارامتر `secret` | ثبت/به‌روزرسانی وب‌هوک |
| `/` | `GET` | عمومی | پیام «KV-Dumper bot is running.» |

## 🔄 استقرار خودکار (CI/CD)

فایل `.github/workflows/deploy.yml` با هر پوش به `main` را با `wrangler-action` روی Cloudflare منتشر می‌کند. برای فعال‌سازی دو Secret ریپازیتوری بسازید (*Settings → Secrets and variables → Actions*):

| Secret | مقدار |
|---|---|
| `CLOUDFLARE_API_TOKEN` | توکن API با مجوز **Workers Scripts: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | شناسهٔ اکانت از داشبورد Cloudflare |

اجرای دستی هم از تب Actions (گزینهٔ `workflow_dispatch`) ممکن است.

## ⬆️ ارتقا از نسخهٔ ۱ به ۲

مایگریشن «درجا» است و داده‌های فعلی حفظ می‌شوند:

```bash
npm run db:upgrade                       # افزودن ستون‌ها و جداول جدید
npx wrangler secret put WEBHOOK_SECRET   # secret جدید برای وب‌هوک
npm run deploy                           # انتشار نسخهٔ جدید
```

سپس `wrangler.toml` محلی را مطابق `wrangler.toml.example` به‌روز کنید (ورودی `main` و بلوک `[triggers]`) و در پایان وب‌هوک را دوباره ثبت کنید: `/setwebhook?secret=<WEBHOOK_SECRET>`

## 🧪 صحت‌سنجی

- ✅ **۱۶/۱۶ چک SQL** — اجرای مایگریشن روی دیتابیس واقعی v1، claim اتمیک، رفتار قفل (دریافت/نگه‌داری/انقضا)، بازیابی آیتم رهاشده، dead-letter و بازگردانی آلبوم
- ✅ **۱۷/۱۷ چک جریان کامل** — اجرای `processQueue` با تلگرام شبیه‌سازی‌شده: آلبوم، صف خالی، بلاک با `bot_status=off`، خطای دائمی 400 → dead-letter با ثبت علت

## 🗺 نقشهٔ راه

- [ ] زمان‌بندی تاریخ/ساعت مشخص برای هر آیتم (ارسال در آینده)
- [ ] چند ادمین با سطوح دسترسی
- [ ] چند کانال با انتخاب مقصد هنگام صف‌بندی
- [ ] پنل چندزبانه
- [ ] صفحهٔ وب داشبورد آماری

## 📄 لایسنس

MIT © [CheginiSoroush](https://github.com/CheginiSoroush) — جزئیات در [LICENSE](LICENSE).
