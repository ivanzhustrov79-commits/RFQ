-- Migration 002: Add background NLP columns to emails table
-- These columns track which emails have been enriched by the LLM
-- and store the enrichment results for the UI to poll.

ALTER TABLE emails ADD COLUMN nlp_status TEXT DEFAULT 'pending';
-- Values: 'pending' = queued for LLM processing
--         'processing' = currently being processed
--         'completed' = LLM enrichment done, results available
--         'failed' = LLM processing failed
--         'skipped' = skipped (e.g. too short, internal email)

ALTER TABLE emails ADD COLUMN nlp_result TEXT;
-- JSON blob: {"supplier_name": "...", "part_numbers": [...], "step": N, "confidence": 0.XX}

ALTER TABLE emails ADD COLUMN nlp_enriched_at TEXT;
-- Timestamp when LLM enrichment completed

-- Index for fast queue queries
CREATE INDEX IF NOT EXISTS idx_emails_nlp_status ON emails(nlp_status);
