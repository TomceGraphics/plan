/** All SQL used by the app lives here so it can be tested against real SQLite. */
export const Q = {
  loadCalendars:
    'SELECT id, name, color, visible, sort, g_id, g_sync_token, read_only FROM calendars ORDER BY sort, created_at',
  loadEvents:
    'SELECT id, calendar_id, title, notes, location, start_ms, end_ms, all_day, rrule, exdates, task_id, done, created_at, updated_at, g_id, g_etag, dirty, g_master, g_orig FROM events',
  loadDeletions: 'SELECT g_id, g_cal FROM sync_deletions',
  loadTasks:
    'SELECT id, title, notes, due, priority, done, done_at, parent_id, sort, estimate, created_at, updated_at FROM tasks',
  loadSettings: 'SELECT key, value FROM settings',

  upsertCalendar:
    'INSERT INTO calendars (id, name, color, visible, sort, created_at, g_id, g_sync_token, read_only) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ' +
    'ON CONFLICT(id) DO UPDATE SET name = $2, color = $3, visible = $4, sort = $5, g_id = $7, g_sync_token = $8, read_only = $9',
  deleteCalendar: 'DELETE FROM calendars WHERE id = $1',
  deleteEventsOfCalendar: 'DELETE FROM events WHERE calendar_id = $1',

  upsertEvent:
    'INSERT INTO events (id, calendar_id, title, notes, location, start_ms, end_ms, all_day, rrule, exdates, task_id, done, created_at, updated_at, g_id, g_etag, dirty, g_master, g_orig) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) ' +
    'ON CONFLICT(id) DO UPDATE SET calendar_id = $2, title = $3, notes = $4, location = $5, start_ms = $6, end_ms = $7, ' +
    'all_day = $8, rrule = $9, exdates = $10, task_id = $11, done = $12, updated_at = $14, ' +
    'g_id = $15, g_etag = $16, dirty = $17, g_master = $18, g_orig = $19',
  deleteEvent: 'DELETE FROM events WHERE id = $1',
  addDeletion: 'INSERT OR IGNORE INTO sync_deletions (g_id, g_cal) VALUES ($1, $2)',
  removeDeletion: 'DELETE FROM sync_deletions WHERE g_id = $1 AND g_cal = $2',
  removeDeletionById: 'DELETE FROM sync_deletions WHERE g_id = $1',
  clearCalendarDeletions: 'DELETE FROM sync_deletions WHERE g_cal = $1',

  upsertTask:
    'INSERT INTO tasks (id, title, notes, due, priority, done, done_at, parent_id, sort, estimate, created_at, updated_at) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ' +
    'ON CONFLICT(id) DO UPDATE SET title = $2, notes = $3, due = $4, priority = $5, done = $6, done_at = $7, ' +
    'parent_id = $8, sort = $9, estimate = $10, updated_at = $12',
  deleteTask: 'DELETE FROM tasks WHERE id = $1',

  setSetting:
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2',
  walMode: 'PRAGMA journal_mode = WAL'
} as const;
