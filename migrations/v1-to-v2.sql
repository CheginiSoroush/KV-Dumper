-- KV-Dumper — in-place upgrade from v1 to v2
--
-- Apply with:
--   wrangler d1 execute kv-dumper-db --remote --file=./migrations/v1-to-v2.sql
--
-- Adds queue state tracking (status/retries/claimed_at), album grouping,
-- a dead-letter table for failed deliveries and a sent history table.

-- 1. Extend the existing queue table.
ALTER TABLE queue ADD COLUMN media_group_id TEXT;
ALTER TABLE queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE queue ADD COLUMN retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;

-- Legacy rows were created without state; normalize them as pending.
UPDATE queue SET status = 'pending' WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_queue_status_id ON queue (status, id);

-- 2. Dead-letter storage for permanently failed items.
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

-- 3. Delivery history for statistics.
CREATE TABLE IF NOT EXISTS sent_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    type     TEXT    NOT NULL,
    sent_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sent_log_sent_at ON sent_log (sent_at);
