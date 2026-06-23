-- Migration 005: Reply-chain headers for deterministic thread assignment
--
-- Adds In-Reply-To and References header storage to emails. These give a
-- near-zero-ambiguity signal for "which conversation does this email belong
-- to" — a direct Message-ID lookup against already-synced emails — instead
-- of relying solely on the subject-prefix heuristic in upsert_email().
--
-- in_reply_to:       the email's In-Reply-To header value (a single Message-ID,
--                    the immediate parent this email is a reply to). Most
--                    emails have at most one.
-- references_header: the raw References header value — a space-separated list
--                    of Message-IDs forming the whole ancestor chain, oldest
--                    first per RFC 5322. Stored raw (not split into rows) since
--                    it's only consulted as a fallback when in_reply_to's
--                    direct parent isn't found in the DB (e.g. that parent
--                    hasn't synced yet, or was skipped).

ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN references_header TEXT;

-- Fast lookup: "does any email have this message_id as its parent" isn't
-- needed (we look up by message_id, already unique-indexed), but we DO look
-- up "what is the in_reply_to value for resolving thread_id" — index speeds
-- up matching against existing rows when checking the reply chain.
CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to);
