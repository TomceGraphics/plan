-- Google Calendar sync (opt-in). Local-only calendars/events simply keep these columns NULL/0.
ALTER TABLE calendars ADD COLUMN g_id TEXT;
ALTER TABLE calendars ADD COLUMN g_sync_token TEXT;
ALTER TABLE calendars ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

ALTER TABLE events ADD COLUMN g_id TEXT;
ALTER TABLE events ADD COLUMN g_etag TEXT;
ALTER TABLE events ADD COLUMN dirty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN g_master TEXT;
ALTER TABLE events ADD COLUMN g_orig INTEGER;
CREATE INDEX IF NOT EXISTS idx_events_gid ON events(g_id);

-- local deletions waiting to be propagated to Google
CREATE TABLE IF NOT EXISTS sync_deletions (
  g_id  TEXT NOT NULL,
  g_cal TEXT NOT NULL,
  PRIMARY KEY (g_id, g_cal)
);
