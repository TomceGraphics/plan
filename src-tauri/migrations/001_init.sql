CREATE TABLE IF NOT EXISTS calendars (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY NOT NULL,
  calendar_id TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  all_day     INTEGER NOT NULL DEFAULT 0,
  rrule       TEXT,
  exdates     TEXT NOT NULL DEFAULT '[]',
  task_id     TEXT,
  done        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_ms);
CREATE INDEX IF NOT EXISTS idx_events_calendar ON events(calendar_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  due        TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    INTEGER,
  parent_id  TEXT,
  sort       REAL NOT NULL DEFAULT 0,
  estimate   INTEGER,
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
