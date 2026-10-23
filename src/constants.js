/**
 * KV-Dumper — Shared constants
 *
 * Single source of truth for button labels, commands, callback payloads
 * and processor tuning. Never hardcode these strings anywhere else.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

/** Reply-keyboard labels shown to the admin. */
export const BTN = {
  FLUSH: '🚀 ارسال تمام محتواها به کانال',
  STOP: '⏹ توقف ارسال صف',
  CLEAR: '🗑 پاکسازی صف',
  STATS: '📊 آمار صف',
  ERRORS: '🔥 خطاهای ارسال',
  PREVIEW: '👁 نمایش آخرین محتواهای صف',
  POWER: '🔌 روشن/خاموش کردن سیستم',
};

/** Slash-command aliases for the panel buttons. */
export const CMD = {
  START: '/start',
  HELP: '/help',
  NOW: '/now',
  STOP: '/stop',
  STATS: '/stats',
  CLEAR: '/clear',
  ERRORS: '/errors',
  PREVIEW: '/preview',
};

/** Inline-keyboard callback payloads. */
export const CB = {
  CONFIRM_CLEAR: 'queue:clear:confirm',
  CANCEL_CLEAR: 'queue:clear:cancel',
  RESTORE_DLQ: 'dlq:restore',
  ASK_CLEAR_DLQ: 'dlq:clear:ask',
  CONFIRM_CLEAR_DLQ: 'dlq:clear:confirm',
  CANCEL_CLEAR_DLQ: 'dlq:clear:cancel',
};

// ---------------------------------------------------------------------------
// Queue processor tuning
// ---------------------------------------------------------------------------

/** Pause between channel posts — keeps the bot well under Telegram flood limits. */
export const SEND_INTERVAL_MS = 10_000;

/** Extra pause after a temporary failure before the next claim. */
export const RETRY_BACKOFF_MS = 5_000;

/** Temporary failures tolerated before an item is dead-lettered. */
export const MAX_RETRIES = 3;

/** Telegram media groups hold at most 10 items. */
export const ALBUM_MAX = 10;

/** Wall-clock budget of a single cron invocation before it yields to the next tick. */
export const PROCESSOR_BUDGET_MS = 60_000;

/** Processing-lock lease; must comfortably exceed the invocation budget. */
export const LOCK_LEASE_MS = 3 * 60_000;

/** Rows stuck in 'sending' older than this are recovered as pending. */
export const STALE_CLAIM_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// Telegram content limits (enqueue-time warnings)
// ---------------------------------------------------------------------------

export const MAX_TEXT_LEN = 4096;
export const MAX_CAPTION_LEN = 1024;

/** Human-readable content-type labels for user-facing messages. */
export const TYPE_LABEL = {
  photo: '🖼 عکس',
  video: '🎬 ویدیو',
  text: '📝 متن',
};
