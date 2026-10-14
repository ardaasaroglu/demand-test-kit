-- Tables for the demand test. Applied by `npm run dev` (local) and `npm run deploy` (remote).
-- WITHOUT ROWID tables keep one copy of each row, so every insert is one written row on D1.

-- One row per page view by a person (bots and opted-out visitors are not recorded).
-- `id` is random per page view and never stored on the visitor's device.
-- `first` is 1 when the visitor had no price cookie yet: summing it counts unique visitors.
CREATE TABLE views (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  variant TEXT NOT NULL,
  src TEXT NOT NULL,
  first INTEGER NOT NULL
) WITHOUT ROWID;

-- Button presses, at most one row per page view and event type.
-- variant and src are copied from the view, never taken from the browser.
CREATE TABLE events (
  view_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  variant TEXT NOT NULL,
  src TEXT NOT NULL,
  PRIMARY KEY (view_id, type)
) WITHOUT ROWID;

-- Waitlist sign-ups. The email address is the key, so a repeat sign-up is ignored.
-- variant is NULL for a visitor who opted out of testing: that sign-up is outside the test.
CREATE TABLE signups (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,
  answer TEXT,
  variant TEXT,
  price REAL,
  src TEXT NOT NULL,
  view_id TEXT,
  consent_version TEXT NOT NULL
) WITHOUT ROWID;
