-- Migration 003: Cross-mailbox supplier matching
-- Same folder name across different mailboxes = same supplier

-- Add normalized folder name column for cross-mailbox matching
ALTER TABLE suppliers ADD COLUMN folder_name_normalized TEXT;

-- Index for fast lookup by folder name
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_folder_name ON suppliers(folder_name_normalized);

-- Also add enrichment_mode tracking to emails
ALTER TABLE emails ADD COLUMN enrichment_mode TEXT DEFAULT 'BASE';
-- Values: 'BASE' = heuristic extraction
--         'SMART' = local Ollama LLM
--         'BOOST' = external API (OpenAI/Claude)
