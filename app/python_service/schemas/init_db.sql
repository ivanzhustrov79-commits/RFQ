-- RFQ Flow v4.3.2 - SQLite Schema

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email_domain TEXT UNIQUE NOT NULL,
  contact_email TEXT,
  default_currency TEXT DEFAULT 'USD',
  open_rfq_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  rfq_name TEXT NOT NULL,
  rfq_name_source TEXT DEFAULT 'auto',
  ci_number TEXT,
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Open',
  source_language TEXT,
  translated_name TEXT,
  confidence_score REAL,
  alarm_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_name TEXT NOT NULL,
  account_email TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  sent_at TEXT NOT NULL,
  body_text TEXT,
  body_language TEXT,
  has_attachments INTEGER DEFAULT 0,
  thread_id TEXT,
  step_assigned INTEGER DEFAULT 0,
  rfq_id INTEGER REFERENCES rfqs(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  parsed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER REFERENCES rfqs(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  part_number TEXT NOT NULL,
  description TEXT,
  quantity INTEGER,
  price REAL,
  currency TEXT,
  is_best_price INTEGER DEFAULT 0,
  quoted_at TEXT
);

CREATE TABLE IF NOT EXISTS alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER REFERENCES rfqs(id),
  alarm_type TEXT NOT NULL,
  urgency TEXT DEFAULT 'Medium',
  reason TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_email, folder_path);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender_email);
CREATE INDEX IF NOT EXISTS idx_parts_rfq ON parts(rfq_id);
