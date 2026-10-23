/**
 * KV-Dumper — Queue data access layer (Cloudflare D1)
 *
 * All multi-statement mutations use db.batch() so they stay atomic.
 * Claiming is a single UPDATE ... RETURNING statement, which makes
 * concurrent invocations safe by design: each row is handed to exactly
 * one processor.
 *
 * Timestamps are millisecond epochs.
 *
 * Author: CheginiSoroush (https://github.com/CheginiSoroush)
 * License: MIT
 */

const CLAIM_COLUMNS = 'id, type, content, caption, media_group_id, retries';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSetting(env, key, fallback = null) {
  const row = await env.db1.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}

export async function setSetting(env, key, value) {
  await env.db1
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value))
    .run();
}

/**
 * Try to acquire the processing lock (time-leased, single holder).
 * Implemented as one atomic upsert: it only succeeds when the stored
 * lease has expired, so overlapping cron invocations cannot double-send.
 */
export async function acquireLock(env, leaseMs) {
  const now = Date.now();
  const res = await env.db1
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('lock_until', ?1)
       ON CONFLICT(key) DO UPDATE SET value = ?2
       WHERE CAST(settings.value AS INTEGER) < ?3`
    )
    .bind(String(now + leaseMs), String(now + leaseMs), String(now))
    .run();
  return (res.meta && res.meta.changes ? res.meta.changes : 0) === 1;
}

export async function releaseLock(env) {
  await env.db1.prepare("UPDATE settings SET value = '0' WHERE key = 'lock_until'").run();
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

/** Persist an item; returns its pending position for the ack message. */
export async function enqueue(env, type, content, caption = '', mediaGroupId = null) {
  await env.db1
    .prepare(
      `INSERT INTO queue (type, content, caption, media_group_id, status, retries, claimed_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)`
    )
    .bind(type, content, caption, mediaGroupId, Date.now())
    .run();
  const row = await env.db1.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'pending'").first();
  return row ? row.n : 0;
}

export async function pendingCount(env) {
  const row = await env.db1.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'pending'").first();
  return row ? row.n : 0;
}

/** Recover rows stuck in 'sending' (e.g. after an invocation crash). */
export async function recoverStaleClaims(env, staleMs) {
  const res = await env.db1
    .prepare("UPDATE queue SET status = 'pending' WHERE status = 'sending' AND claimed_at > 0 AND claimed_at < ?")
    .bind(Date.now() - staleMs)
    .run();
  return (res.meta && res.meta.changes) || 0;
}

/** Atomically claim the oldest pending item. Returns null when the queue is empty. */
export async function claimNext(env) {
  const res = await env.db1
    .prepare(
      `UPDATE queue SET status = 'sending', claimed_at = ?
       WHERE id = (SELECT id FROM queue WHERE status = 'pending' ORDER BY id LIMIT 1)
       RETURNING ${CLAIM_COLUMNS}`
    )
    .bind(Date.now())
    .all();
  return (res.results && res.results[0]) || null;
}

/** Claim pending members of an album group (the first item is already claimed). */
export async function claimAlbumMembers(env, mediaGroupId, limit) {
  const res = await env.db1
    .prepare(
      `UPDATE queue SET status = 'sending', claimed_at = ?
       WHERE status = 'pending' AND media_group_id = ?
       RETURNING ${CLAIM_COLUMNS}`
    )
    .bind(Date.now(), mediaGroupId)
    .all();
  return (res.results || []).slice(0, limit);
}

/** Put a claimed item back into rotation (temporary failure); bumps the retry counter. */
export async function requeue(env, id) {
  await env.db1.prepare("UPDATE queue SET status = 'pending', retries = retries + 1 WHERE id = ?").bind(id).run();
}

/** Remove a delivered item and record it in the sent history — one atomic batch. */
export async function complete(env, item) {
  await env.db1.batch([
    env.db1.prepare('DELETE FROM queue WHERE id = ?').bind(item.id),
    env.db1.prepare('INSERT INTO sent_log (type, sent_at) VALUES (?, ?)').bind(item.type, Date.now()),
  ]);
}

/** Move a permanently failed item to the dead-letter table — one atomic batch. */
export async function deadLetter(env, item, errorText) {
  await env.db1.batch([
    env.db1.prepare('DELETE FROM queue WHERE id = ?').bind(item.id),
    env.db1
      .prepare(
        `INSERT INTO dead_letter (type, content, caption, media_group_id, error, retries, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(item.type, item.content, item.caption || '', item.media_group_id || null, String(errorText).slice(0, 500), item.retries || 0, Date.now()),
  ]);
}

export async function clearPending(env) {
  const res = await env.db1.prepare("DELETE FROM queue WHERE status = 'pending'").run();
  return (res.meta && res.meta.changes) || 0;
}

/** Newest pending items, oldest first (for the preview panel). */
export async function previewPending(env, limit) {
  const res = await env.db1
    .prepare('SELECT id, type, content, caption FROM queue WHERE status = ? ORDER BY id DESC LIMIT ?')
    .bind('pending', limit)
    .all();
  return (res.results || []).reverse();
}

// ---------------------------------------------------------------------------
// Dead-letter operations
// ---------------------------------------------------------------------------

export async function deadLetterCount(env) {
  const row = await env.db1.prepare('SELECT COUNT(*) AS n FROM dead_letter').first();
  return row ? row.n : 0;
}

export async function listDeadLetters(env, limit) {
  const res = await env.db1
    .prepare('SELECT id, type, content, caption, error FROM dead_letter ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all();
  return res.results || [];
}

/** Move dead-letter entries back into the pending queue, regrouping albums. */
export async function restoreDeadLetters(env, limit = 100) {
  const res = await env.db1
    .prepare('SELECT id, type, content, caption, media_group_id FROM dead_letter ORDER BY id LIMIT ?')
    .bind(limit)
    .all();
  const items = res.results || [];
  if (!items.length) return 0;

  const statements = items.map(item =>
    env.db1
      .prepare(
        `INSERT INTO queue (type, content, caption, media_group_id, status, retries, claimed_at, created_at)
         VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)`
      )
      .bind(item.type, item.content, item.caption || '', item.media_group_id || null, Date.now())
  );
  statements.push(env.db1.prepare('DELETE FROM dead_letter'));

  await env.db1.batch(statements);
  return items.length;
}

export async function clearDeadLetters(env) {
  const res = await env.db1.prepare('DELETE FROM dead_letter').run();
  return (res.meta && res.meta.changes) || 0;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Aggregated counters for the stats panel. */
export async function stats(env) {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const [pending, failed, sentToday, sentTotal] = await env.db1.batch([
    env.db1.prepare("SELECT COUNT(*) AS n FROM queue WHERE status = 'pending'"),
    env.db1.prepare('SELECT COUNT(*) AS n FROM dead_letter'),
    env.db1.prepare('SELECT COUNT(*) AS n FROM sent_log WHERE sent_at > ?').bind(dayAgo),
    env.db1.prepare('SELECT COUNT(*) AS n FROM sent_log'),
  ]);
  const n = r => (r.results && r.results[0] ? r.results[0].n : 0);
  return { pending: n(pending), failed: n(failed), sentToday: n(sentToday), sentTotal: n(sentTotal) };
}
