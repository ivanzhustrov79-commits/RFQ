-- ============================================================================
-- NEW TABLES — Sync Reliability + Tiered Learning Feedback
-- Add this block to your init_db.sql (or run once via executescript).
-- Does not touch/modify any existing table — purely additive.
-- ============================================================================

-- Tracks one verification check per folder per sync pass.
-- expected_count = what the Electron streaming parser counted while reading the mbox.
-- actual_count   = what's actually in the `emails` table for that folder/account right now.
-- A mismatch (actual < expected) is what triggers the retry/escalation flow.
CREATE TABLE IF NOT EXISTS sync_verification (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    actual_count INTEGER NOT NULL,
    is_match INTEGER NOT NULL,              -- 1 if expected == actual, 0 otherwise
    checked_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_verification_account
    ON sync_verification(account_email, folder_path);

-- One row per detected sync failure (a folder/account combo where counts didn't match).
-- retry_count increments on each automatic retry attempt (cap at 3 — enforced in code).
-- status moves: 'pending' -> 'retrying' -> ('resolved' | 'escalated').
-- escalated = retries exhausted, report generated, waiting on user to send to Deepseek
-- (or already sent, waiting on response).
CREATE TABLE IF NOT EXISTS sync_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_email TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    expected_count INTEGER NOT NULL,
    actual_count INTEGER NOT NULL,
    missing_count INTEGER NOT NULL,          -- expected - actual, for quick sorting/display
    retry_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',           -- pending | retrying | resolved | escalated
    first_detected_at TEXT DEFAULT (datetime('now')),
    last_retry_at TEXT,
    resolved_at TEXT,
    report_json TEXT,                        -- the full bundled report sent/sendable to Deepseek
    deepseek_response_json TEXT,             -- raw structured response once received
    UNIQUE(account_email, folder_path, first_detected_at)
);

CREATE INDEX IF NOT EXISTS idx_sync_failures_status ON sync_failures(status);

-- Specific emails implicated in a sync failure — known from PUSH-DIAG/message_id
-- tracking during the sync attempt. Lets the report (and the eventual targeted
-- re-review after a fix) point at exact rows instead of "the whole folder."
CREATE TABLE IF NOT EXISTS sync_failure_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_failure_id INTEGER NOT NULL REFERENCES sync_failures(id),
    message_id TEXT,                         -- NULL if the email never got a message_id at all
    raw_header_snippet TEXT,                 -- first ~500 chars of headers, for diagnosis
    reason TEXT                              -- e.g. 'db_error', 'missing_after_persist', 'parse_skip'
);

CREATE INDEX IF NOT EXISTS idx_sync_failure_emails_failure
    ON sync_failure_emails(sync_failure_id);

-- Records every fix received from Deepseek (or any future external diagnostic API),
-- tiered by scope per your spec:
--   1 = general_recognition  (affects raw parsing/ingestion for a class of emails)
--   2 = rfq_sorting           (affects which RFQ/supplier an email attaches to)
--   3 = step_sorting          (affects step_assigned within an already-correct RFQ)
-- scope_filter_json describes exactly which existing emails this fix should be
-- re-applied to (see apply_learned_fix() below for how it's interpreted per tier).
CREATE TABLE IF NOT EXISTS learned_fixes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_failure_id INTEGER REFERENCES sync_failures(id),  -- NULL if not failure-triggered
    tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
    fix_description TEXT NOT NULL,
    scope_filter_json TEXT NOT NULL,
    confidence REAL,
    source TEXT DEFAULT 'deepseek',
    applied INTEGER DEFAULT 0,
    emails_reviewed INTEGER DEFAULT 0,
    emails_changed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_learned_fixes_tier ON learned_fixes(tier);
