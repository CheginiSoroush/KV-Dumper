-- KV-Dumper v2 — database schema (fresh installations)
--
-- Apply with:
--   wrangler d1 execute kv-dumper-db --remote --file=./schema.sql
--
-- Existing v1 installations should use migrations/v1-to-v2.sql instead.

-- Key/value store for runtime flags (bot_status, flush_enabled, lock_until).
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Content queue. Items are claimed atomically by the cron processor
-- via UPDATE ... RETURNING, so concurrent invocations are safe.
CREATE TABLE IF NOT EXISTS queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT    NOT NULL,              -- 'photo' | 'video' | 'text'
    content        TEXT    NOT NULL,              -- Telegram file_id or text body
    caption        TEXT    NOT NULL DEFAULT '',
    media_group_id TEXT,                          -- set for album members (photos/videos)
    status         TEXT    NOT NULL DEFAULT 'pending', -- 'pending' | 'sending'
    retries        INTEGER NOT NULL DEFAULT 0,
    claimed_at     INTEGER NOT NULL DEFAULT 0,    -- ms epoch of the last claim
    created_at     INTEGER NOT NULL DEFAULT 0     -- ms epoch of enqueue
);

CREATE INDEX IF NOT EXISTS idx_queue_status_id ON queue (status, id);

-- Permanently failed items, kept for admin review and manual restore.
CREATE TABLE IF NOT EXISTS dead_letter (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    type           TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    caption        TEXT    NOT NULL DEFAULT '',
    media_group_id TEXT,
    error          TEXT    NOT NULL DEFAULT '',
    retries        INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL DEFAULT 0
);

-- Delivery history used by the stats panel.
CREATE TABLE IF NOT EXISTS sent_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    type     TEXT    NOT NULL,
    sent_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sent_log_sent_at ON sent_log (sent_at);
