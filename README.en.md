<div align="center">

# 📨 KV-Dumper

**Telegram content queueing & scheduled publishing bot**
**Fully serverless on Cloudflare Workers + D1**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-blueviolet)](../../releases)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Database](https://img.shields.io/badge/Database-D1-orange)](https://developers.cloudflare.com/d1/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot_API-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Checks](https://img.shields.io/badge/checks-33%2F33%20passed-brightgreen)](#-verification)
[![Deploy](https://github.com/CheginiSoroush/KV-Dumper/actions/workflows/deploy.yml/badge.svg)](../../actions/workflows/deploy.yml)

**[🌐 Project page](https://cheginisoroush.github.io/KV-Dumper/)** &nbsp;·&nbsp; **English** | [فارسی](README.md)

</div>

---

KV-Dumper queues whatever you send it — photos, videos, text and albums — and publishes everything to your channel at safe, collision-free intervals with a single button press. There is no server to run: just a free Worker, a D1 database and a cron trigger firing once a minute.

> 💡 **Free, zero-maintenance:** the Workers free tier is plenty for personal use, and all data persists in D1 — even across failures.

## 📑 Table of contents

- [✨ Features](#-features)
- [🧱 Architecture](#-architecture)
- [🚀 Quick start](#-quick-start)
- [🔐 Variables & secrets](#-variables--secrets)
- [🤖 Admin panel](#-admin-panel)
- [🗄 Database](#-database)
- [⚙️ Processor tuning](#️-processor-tuning)
- [🌐 HTTP endpoints](#-http-endpoints)
- [🔄 Continuous deployment (CI/CD)](#-continuous-deployment-cicd)
- [⬆️ Upgrading from v1](#️-upgrading-from-v1)
- [🧪 Verification](#-verification)
- [🗺 Roadmap](#-roadmap)
- [📄 License](#-license)

## ✨ Features

| | Feature | Description |
|---|---|---|
| 📥 | **Content queueing** | Every photo, video or text you send to the bot is stored in the queue |
| ⏱ | **Scheduled publishing** | A cron processor paced at 10 s per post, well under Telegram's flood limits |
| 🖼 | **Album support** | Members of a `media_group` are delivered together via `sendMediaGroup` |
| 🔐 | **Secure webhook** | Validates the `X-Telegram-Bot-Api-Secret-Token` header; strangers get a `403` |
| 🔁 | **Smart retries** | Temporary failures retry up to 3×; Telegram's 429 `retry_after` is honoured |
| 🔥 | **Dead letter queue** | Permanent failures are stored with their cause for admin review & restore |
| 🚫 | **No duplicate sends** | Atomic `UPDATE ... RETURNING` claiming — each item reaches exactly one processor |
| 📊 | **Stats & preview** | Pending, failures, today's and total sends + a preview of the last 5 items |
| ⏹ | **Full control** | Start/stop flushing, purge with inline confirmation, master power switch |
| 🧩 | **Modular design** | Six focused modules with a single source of truth for config & labels |

## 🧱 Architecture

```text
                    ┌─────────────────────────────────────────────┐
                    │              Cloudflare Worker              │
  Telegram admin ─▶ │  /webhook ──▶ handlers.js ─┐                │
                    │                            ├──▶ queue.js ──▶ D1
  Cron (per minute)▶│  scheduled ──▶ processor ──┤       ▲         │
                    │                    │       └──▶ settings   │
                    │                    ▼                 │       │
                    │              telegram.js ────▶ Bot API ──▶ 📣 Channel
                    └─────────────────────────────────────────────┘
```

| Module | Responsibility |
|---|---|
| `src/index.js` | Worker entry: `fetch` routing and the `scheduled` (cron) handler |
| `src/handlers.js` | Admin interaction: content queueing, panel buttons, inline confirmations |
| `src/processor.js` | Batch queue processor: lock, claim, delivery, retries, final report |
| `src/queue.js` | Data-access layer: atomic claiming, dead-letter, statistics |
| `src/telegram.js` | Bot API client returning structured errors (including `retry_after`) |
| `src/constants.js` | Single source of truth: button labels, commands, processor tuning |

**Failure policy:** temporary failures (network, 5xx, 429) are retried after a backoff; permanent ones (4xx) or exhausted retries land in `dead_letter` — no data is ever silently lost. If a processor dies mid-flight, half-claimed rows are automatically recovered after `STALE_CLAIM_MS`.

## 🚀 Quick start

**Prerequisites:** Node.js 18+, a Telegram bot ([@BotFather](https://t.me/BotFather)), a Cloudflare account.

```bash
# 1) Clone & install
git clone https://github.com/CheginiSoroush/KV-Dumper.git
cd KV-Dumper && npm install

# 2) Create the D1 database (copy its id)
npx wrangler d1 create kv-dumper-db

# 3) Create the config file and put the database id in it
cp wrangler.toml.example wrangler.toml
#    open it and replace <YOUR_D1_DATABASE_ID>

# 4) Create the tables
npm run db:init

# 5) Set the secrets
npx wrangler secret put BOT_TOKEN        # token from @BotFather
npx wrangler secret put ADMIN_ID         # your numeric id (@userinfobot)
npx wrangler secret put CHANNEL_ID       # e.g. @mychannel
npx wrangler secret put WEBHOOK_SECRET   # generate with: openssl rand -hex 32

# 6) Deploy
npm run deploy
```

Finally register the webhook — open this URL in a browser:

```text
https://kv-dumper.<your-subdomain>.workers.dev/setwebhook?secret=<WEBHOOK_SECRET>
```

Send `/start` to your bot and the admin panel opens with its buttons. Done! 🎉

## 🔐 Variables & secrets

| Name | Kind | Description |
|---|---|---|
| `BOT_TOKEN` | Secret | Bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_ID` | Secret | Your numeric user id — only this chat can control the bot |
| `CHANNEL_ID` | Secret | Delivery target; `@channelusername` or numeric id |
| `WEBHOOK_SECRET` | Secret | Shared webhook key; generate with `openssl rand -hex 32` |
| `db1` | Binding | D1 database (in `wrangler.toml`) |

> ⚠️ **Security note:** admin rights are checked strictly against `ADMIN_ID`, and the webhook rejects any request without the secret header with `403`. Channel posts are sent without `parse_mode` so user content is never interpreted as HTML.

## 🤖 Admin panel

| Button | Action |
|---|---|
| 🚀 Send all queued content to the channel | Start flushing with an ETA report |
| ⏹ Stop flushing | Pause processing; items stay in the queue |
| 🗑 Purge the queue | Drop all pending items — with inline confirmation |
| 📊 Queue stats | System state + pending, failed, 24 h and total counters |
| 👁 Preview the last queued items | Shows the newest 5 pending entries |
| 🔥 Delivery errors | Failure list with causes + bulk restore / purge with confirmation |
| 🔌 Power on/off | Master switch; while off only this button and `/help` respond |

**Commands:** `/now` · `/stop` · `/stats` · `/preview` · `/errors` · `/clear` · `/help`

At enqueue time the bot warns you if text exceeds 4096 or a caption exceeds 1024 characters — before anything ever reaches the channel.

## 🗄 Database

| Table | Purpose |
|---|---|
| `queue` | Content queue with status (`pending` / `sending`), retry counter, `media_group_id` and claim timestamps |
| `dead_letter` | Permanently failed items, kept with the error cause |
| `sent_log` | Delivery history (basis for the "today" and "total" stats) |
| `settings` | Key/value store for runtime flags (`bot_status`, `flush_enabled`, `lock_until`) |

Fresh install: `schema.sql` — in-place v1→v2 upgrade without data loss: `migrations/v1-to-v2.sql`

## ⚙️ Processor tuning

All in `src/constants.js` — no need to touch the logic:

| Constant | Default | Description |
|---|---|---|
| `SEND_INTERVAL_MS` | 10 s | Pause between channel posts |
| `RETRY_BACKOFF_MS` | 5 s | Pause after a temporary failure |
| `MAX_RETRIES` | 3 | Retries tolerated before dead-lettering |
| `ALBUM_MAX` | 10 | Max album members (Telegram limit) |
| `PROCESSOR_BUDGET_MS` | 60 s | Wall-clock budget of one cron tick |
| `LOCK_LEASE_MS` | 3 min | Processor-lock lease (must exceed the budget) |
| `STALE_CLAIM_MS` | 5 min | Recovery threshold for rows stuck in `sending` |

## 🌐 HTTP endpoints

| Path | Method | Protection | Purpose |
|---|---|---|---|
| `/webhook` | `POST` | `X-Telegram-Bot-Api-Secret-Token` header | Receives Telegram updates |
| `/setwebhook?secret=…` | `GET` | `secret` query param | Registers/updates the webhook |
| `/` | `GET` | public | Returns "KV-Dumper bot is running." |

## 🔄 Continuous deployment (CI/CD)

`.github/workflows/deploy.yml` publishes every push to `main` via `wrangler-action`. Enable it by creating two repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Account id from the Cloudflare dashboard |

Manual runs are available from the Actions tab (`workflow_dispatch`).

## ⬆️ Upgrading from v1

The migration runs in place and keeps your existing data:

```bash
npm run db:upgrade                       # add the new columns & tables
npx wrangler secret put WEBHOOK_SECRET   # new webhook secret
npm run deploy                           # ship the new version
```

Then update your local `wrangler.toml` to match `wrangler.toml.example` (the `main` entry and the `[triggers]` block) and re-register the webhook: `/setwebhook?secret=<WEBHOOK_SECRET>`

## 🧪 Verification

- ✅ **16/16 SQL checks** — migration applied to a real v1 database, atomic claiming, lock acquire/hold/expire behaviour, stale-claim recovery, dead-lettering and album restore
- ✅ **17/17 end-to-end flow checks** — `processQueue` executed against a mock Telegram API: albums, empty queue, blocking with `bot_status=off`, permanent 400 failure → dead-letter with the cause recorded

## 🗺 Roadmap

- [ ] Per-item publish scheduling (send at a future date/time)
- [ ] Multiple admins with permission levels
- [ ] Multiple channels with per-item destination choice
- [ ] Multilingual panel
- [ ] Web dashboard for stats

## 📄 License

MIT © [CheginiSoroush](https://github.com/CheginiSoroush) — see [LICENSE](LICENSE).
