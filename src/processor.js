/**
 * KV-Dumper — Queue processor
 *
 * Runs from the cron trigger (every minute). Each invocation:
 *   1. bails out unless flushing is enabled,
 *   2. acquires a time-leased lock so only one invocation processes,
 *   3. claims items atomically (albums are claimed as a group),
 *   4. delivers them with an anti-flood interval, honouring retry_after,
 *   5. stops after a wall-clock budget and lets the next tick continue.
 *
 * Failure policy:
 *   - permanent failures (4xx) and exhausted retries go to dead_letter,
 *   - temporary failures (network, 5xx, 429) are requeued and retried.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

import {
  ALBUM_MAX,
  LOCK_LEASE_MS,
  MAX_RETRIES,
  PROCESSOR_BUDGET_MS,
  RETRY_BACKOFF_MS,
  SEND_INTERVAL_MS,
  STALE_CLAIM_MS,
} from './constants.js';
import { sendAdminMessage, tgCall } from './telegram.js';
import * as queue from './queue.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Drain the queue for one cron tick.
 * Safe to run concurrently: the lock guarantees a single processor.
 */
export async function processQueue(env) {
  if ((await queue.getSetting(env, 'flush_enabled')) !== 'on') return;
  if (!(await queue.acquireLock(env, LOCK_LEASE_MS))) return;

  const startedAt = Date.now();
  let sentCount = 0;
  let failedCount = 0;

  try {
    await queue.recoverStaleClaims(env, STALE_CLAIM_MS);

    while (Date.now() - startedAt < PROCESSOR_BUDGET_MS) {
      if ((await queue.getSetting(env, 'bot_status', 'on')) === 'off') break;
      if ((await queue.getSetting(env, 'flush_enabled')) !== 'on') break;

      const group = await claimNextGroup(env);
      if (!group) break;

      const outcome = await deliver(env, group, startedAt);

      if (outcome === 'sent') {
        sentCount += group.length;
        await sleep(SEND_INTERVAL_MS);
      } else if (outcome === 'retry-later') {
        await sleep(RETRY_BACKOFF_MS);
      }
      // 'dead-lettered' and 'deferred' fall through to the next claim immediately.
    }
  } finally {
    await queue.releaseLock(env);
  }

  await finalizeFlush(env, sentCount, failedCount);
}

/**
 * When the queue is fully drained, stop flushing and report the result.
 * A quiet drain (nothing processed) only clears the flag.
 */
async function finalizeFlush(env, sentCount, failedCount) {
  const remaining = await queue.pendingCount(env);
  if (remaining !== 0) return;
  if ((await queue.getSetting(env, 'flush_enabled')) !== 'on') return;

  await queue.setSetting(env, 'flush_enabled', 'off');
  if (sentCount + failedCount > 0) {
    await sendAdminMessage(
      env,
      [
        '✅ <b>صف کامل ارسال شد.</b>',
        '',
        `📬 ارسال موفق: <b>${sentCount}</b>`,
        `🔥 خطا (منتقل‌شده به لیست خطاها): <b>${failedCount}</b>`,
      ].join('\n')
    );
  }
}

/**
 * Claim the next pending item; when it belongs to an album
 * (media_group_id) claim the whole group up to ALBUM_MAX.
 */
async function claimNextGroup(env) {
  const first = await queue.claimNext(env);
  if (!first) return null;
  if (!first.media_group_id) return [first];

  const rest = await queue.claimAlbumMembers(env, first.media_group_id, ALBUM_MAX - 1);
  return [first, ...rest];
}

/**
 * Deliver a claimed group and resolve its fate.
 * @returns {'sent'|'retry-later'|'dead-lettered'|'deferred'}
 */
async function deliver(env, group, startedAt) {
  const attempt = group.length === 1 ? await sendSingle(env, group[0]) : await sendAlbum(env, group);

  if (attempt.ok) {
    await Promise.all(group.map(item => queue.complete(env, item)));
    return 'sent';
  }

  // Flood control: respect retry_after, then try exactly once more.
  if (attempt.status === 429 && attempt.retryAfter) {
    const waitMs = (attempt.retryAfter + 1) * 1000;
    if (Date.now() + waitMs >= startedAt + PROCESSOR_BUDGET_MS) {
      await requeueGroup(env, group);
      return 'deferred';
    }
    await sleep(waitMs);
    const retry = group.length === 1 ? await sendSingle(env, group[0]) : await sendAlbum(env, group);
    if (retry.ok) {
      await Promise.all(group.map(item => queue.complete(env, item)));
      return 'sent';
    }
    return handleFailure(env, group, retry);
  }

  return handleFailure(env, group, attempt);
}

/** Classify a failure and either schedule a retry or dead-letter the group. */
async function handleFailure(env, group, failure) {
  const temporary = failure.status === null || failure.status === 429 || failure.status >= 500;
  const description = failure.description || 'unknown error';

  if (!temporary) {
    for (const item of group) {
      await queue.deadLetter(env, item, description);
    }
    return 'dead-lettered';
  }

  const retriesExhausted = group.every(item => (item.retries || 0) + 1 >= MAX_RETRIES);
  if (retriesExhausted) {
    for (const item of group) {
      await queue.deadLetter(env, item, `retries exhausted — last error: ${description}`);
    }
    return 'dead-lettered';
  }

  await requeueGroup(env, group);
  return 'retry-later';
}

async function requeueGroup(env, group) {
  for (const item of group) {
    await queue.requeue(env, item.id);
  }
}

// ---------------------------------------------------------------------------
// Channel delivery
// ---------------------------------------------------------------------------

/** Send a single item. Text posts are sent without parse_mode by design. */
async function sendSingle(env, item) {
  if (item.type === 'text') {
    return tgCall(env, 'sendMessage', { chat_id: env.CHANNEL_ID, text: item.content });
  }
  if (item.type === 'photo') {
    return tgCall(env, 'sendPhoto', {
      chat_id: env.CHANNEL_ID,
      photo: item.content,
      caption: item.caption || undefined,
    });
  }
  return tgCall(env, 'sendVideo', {
    chat_id: env.CHANNEL_ID,
    video: item.content,
    caption: item.caption || undefined,
  });
}

/** Send an album group via sendMediaGroup (each item keeps its own caption). */
async function sendAlbum(env, group) {
  const media = group.map(item => ({
    type: item.type === 'video' ? 'video' : 'photo',
    media: item.content,
    ...(item.caption ? { caption: item.caption } : {}),
  }));
  return tgCall(env, 'sendMediaGroup', { chat_id: env.CHANNEL_ID, media });
}
