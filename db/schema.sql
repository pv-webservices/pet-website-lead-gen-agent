PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER  PRIMARY KEY AUTOINCREMENT,
  place_id          TEXT     NOT NULL UNIQUE,
  name              TEXT     NOT NULL,
  address           TEXT,
  phone             TEXT,
  rating            REAL,
  review_count      INTEGER,
  categories        TEXT,
  website           TEXT,
  source_keyword    TEXT     NOT NULL,
  score             REAL,
  outreach_message  TEXT,
  status            TEXT     NOT NULL DEFAULT 'new'
                    CHECK(status IN ('new', 'scored', 'outreach_ready', 'contacted', 'converted', 'rejected')),
  created_at        TEXT     NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT     NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS leads_updated_at
  AFTER UPDATE ON leads
  FOR EACH ROW
BEGIN
  UPDATE leads SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads(score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_place_id ON leads(place_id);
