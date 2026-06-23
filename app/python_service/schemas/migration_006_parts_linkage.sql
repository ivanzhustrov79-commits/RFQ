-- Migration 006: Make the `parts` table live, and link it to threads/emails
-- so it can serve as the matching index for part-number-based reconciliation.
--
-- The `parts` table existed in the original schema but nothing ever wrote to
-- it — part numbers extracted by the NLP pipeline only ever landed inside
-- emails.nlp_result as a JSON blob, with no cross-email identity. This
-- migration adds the columns needed to actually use it as a real index:
--
-- thread_id:      which thread this part number was seen in. Stored as TEXT
--                 to match emails.thread_id's existing (SQLite TEXT-affinity)
--                 convention — not a strict FK, mirroring how thread_id is
--                 already used elsewhere in this codebase.
-- message_id:     which specific email this part number was extracted from
--                 (traceability/audit — lets you find the source email later).
-- email_sent_at:  denormalized copy of that email's sent_at. Stored directly
--                 here (rather than requiring a join back to emails every
--                 time) so the time-window check in reconcile_thread_by_part_
--                 numbers() stays a single fast indexed query.

ALTER TABLE parts ADD COLUMN thread_id TEXT;
ALTER TABLE parts ADD COLUMN message_id TEXT;
ALTER TABLE parts ADD COLUMN email_sent_at TEXT;

-- The core lookup this whole feature depends on: "does this supplier already
-- have this part number somewhere else."
CREATE INDEX IF NOT EXISTS idx_parts_supplier_partnum ON parts(supplier_id, part_number);
