"""RFQ Flow Python Service - SQLite Database Layer"""
import aiosqlite
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
import logging

from config import DB_PATH, SCHEMAS_DIR

logger = logging.getLogger(__name__)
_db: Optional[aiosqlite.Connection] = None


async def get_db() -> aiosqlite.Connection:
    """Get or create async SQLite connection."""
    global _db
    if _db is None:
        _db = await aiosqlite.connect(DB_PATH)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
    return _db


async def close_db():
    """Close database connection."""
    global _db
    if _db:
        await _db.close()
        _db = None


async def init_db():
    """Initialize database with schema if empty."""
    schema_path = SCHEMAS_DIR / "init_db.sql"
    if not schema_path.exists():
        logger.warning("Schema file not found, creating tables manually")
        await _create_tables_manual()
        return

    schema = schema_path.read_text(encoding="utf-8")
    db = await get_db()

    # Check if already initialized
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='emails'"
    )
    if await cursor.fetchone():
        logger.info("Database already initialized")
        return

    await db.executescript(schema)
    await db.commit()
    logger.info("Database initialized from schema")


async def _create_tables_manual():
    """Fallback: create tables if schema file missing."""
    db = await get_db()
    await db.executescript("""
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

        CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_email, folder_path);
        CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
        CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender_email);
        CREATE INDEX IF NOT EXISTS idx_parts_rfq ON parts(rfq_id);
    """)
    await db.commit()
    logger.info("Database initialized (manual fallback)")


# ── CRUD Operations ──

async def upsert_email(data: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update email by message_id."""
    db = await get_db()

    # Check if exists
    cursor = await db.execute(
        "SELECT id FROM emails WHERE message_id = ?",
        (data.get("message_id"),)
    )
    existing = await cursor.fetchone()

    if existing:
        # Update
        await db.execute("""
            UPDATE emails SET
                profile_name = ?, account_email = ?, folder_path = ?,
                subject = ?, sender_email = ?, sender_name = ?,
                sent_at = ?, body_text = ?, body_language = ?,
                has_attachments = ?, thread_id = ?, step_assigned = ?,
                rfq_id = ?, supplier_id = ?, parsed_at = datetime('now')
            WHERE message_id = ?
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("subject"), data.get("sender_email"), data.get("sender_name"),
            data.get("sent_at"), data.get("body_text"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"), data.get("step_assigned", 0),
            data.get("rfq_id"), data.get("supplier_id"),
            data.get("message_id"),
        ))
        await db.commit()
        return {"email_id": existing["id"], "action": "updated"}

    # Insert
    cursor = await db.execute("""
        INSERT INTO emails (
            profile_name, account_email, folder_path, message_id,
            subject, sender_email, sender_name, sent_at,
            body_text, body_language, has_attachments, thread_id,
            step_assigned, rfq_id, supplier_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
        data.get("message_id"), data.get("subject"),
        data.get("sender_email"), data.get("sender_name"), data.get("sent_at"),
        data.get("body_text"), data.get("body_language"),
        1 if data.get("has_attachments") else 0,
        data.get("thread_id"), data.get("step_assigned", 0),
        data.get("rfq_id"), data.get("supplier_id"),
    ))
    await db.commit()
    return {"email_id": cursor.lastrowid, "action": "inserted"}


async def query_emails(
    account: str,
    folder: Optional[str] = None,
    step: Optional[int] = None,
    supplier_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
) -> Dict[str, Any]:
    """Query emails with filters."""
    db = await get_db()

    conditions = ["account_email = ?"]
    params: List[Any] = [account]

    if folder:
        conditions.append("folder_path = ?")
        params.append(folder)
    if step is not None:
        conditions.append("step_assigned = ?")
        params.append(step)
    if supplier_id is not None:
        conditions.append("supplier_id = ?")
        params.append(supplier_id)

    where_clause = " AND ".join(conditions)

    # Count total
    count_cursor = await db.execute(
        f"SELECT COUNT(*) as total FROM emails WHERE {where_clause}", params
    )
    total = (await count_cursor.fetchone())["total"]

    # Fetch emails
    params.extend([limit, offset])
    cursor = await db.execute(
        f"""
        SELECT * FROM emails
        WHERE {where_clause}
        ORDER BY sent_at DESC
        LIMIT ? OFFSET ?
        """, params
    )
    rows = await cursor.fetchall()

    emails = [dict(row) for row in rows]
    for e in emails:
        e["has_attachments"] = bool(e.get("has_attachments"))

    return {
        "total": total,
        "returned": len(emails),
        "offset": offset,
        "emails": emails,
    }


async def get_supplier_by_domain(domain: str) -> Optional[Dict[str, Any]]:
    """Get supplier by email domain."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM suppliers WHERE email_domain = ?",
        (domain,)
    )
    row = await cursor.fetchone()
    return dict(row) if row else None


async def upsert_supplier(data: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update supplier by email_domain."""
    db = await get_db()

    cursor = await db.execute(
        "SELECT id FROM suppliers WHERE email_domain = ?",
        (data.get("email_domain"),)
    )
    existing = await cursor.fetchone()

    if existing:
        await db.execute("""
            UPDATE suppliers SET
                name = ?, contact_email = ?, default_currency = ?,
                updated_at = datetime('now')
            WHERE email_domain = ?
        """, (
            data.get("name"), data.get("contact_email"),
            data.get("default_currency", "USD"),
            data.get("email_domain"),
        ))
        await db.commit()
        return {"supplier_id": existing["id"], "action": "updated"}

    cursor = await db.execute("""
        INSERT INTO suppliers (name, email_domain, contact_email, default_currency)
        VALUES (?, ?, ?, ?)
    """, (
        data.get("name"), data.get("email_domain"),
        data.get("contact_email"), data.get("default_currency", "USD"),
    ))
    await db.commit()
    return {"supplier_id": cursor.lastrowid, "action": "inserted"}


# ── Background NLP Queue ──

async def queue_emails_for_nlp(message_ids: List[str]) -> int:
    """Mark emails as pending for background LLM enrichment.
    Only queues emails that haven't been processed yet."""
    db = await get_db()
    # Use parameterized query with placeholders
    placeholders = ','.join('?' * len(message_ids))
    await db.execute(f"""
        UPDATE emails SET nlp_status = 'pending'
        WHERE message_id IN ({placeholders})
        AND (nlp_status IS NULL OR nlp_status IN ('pending', 'failed'))
    """, message_ids)
    await db.commit()
    return db.total_changes


async def get_next_nlp_pending() -> Optional[Dict[str, Any]]:
    """Get the next email waiting for LLM enrichment."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT id, message_id, subject, body_text, sender_email, body_language
        FROM emails
        WHERE nlp_status = 'pending'
        ORDER BY sent_at DESC
        LIMIT 1
    """)
    row = await cursor.fetchone()
    return dict(row) if row else None


async def mark_nlp_processing(email_id: int) -> None:
    """Mark an email as currently being processed."""
    db = await get_db()
    await db.execute(
        "UPDATE emails SET nlp_status = 'processing' WHERE id = ?",
        (email_id,)
    )
    await db.commit()


async def save_nlp_result(email_id: int, result: Dict[str, Any]) -> None:
    """Save LLM enrichment result and mark as completed."""
    import json
    db = await get_db()
    # Update step_assigned if we got a valid step
    step = result.get("step", 0)
    if step and step >= 1:
        await db.execute("""
            UPDATE emails SET
                nlp_status = 'completed',
                nlp_result = ?,
                nlp_enriched_at = datetime('now'),
                step_assigned = ?
            WHERE id = ?
        """, (json.dumps(result), step, email_id))
    else:
        await db.execute("""
            UPDATE emails SET
                nlp_status = 'completed',
                nlp_result = ?,
                nlp_enriched_at = datetime('now')
            WHERE id = ?
        """, (json.dumps(result), email_id))
    await db.commit()


async def mark_nlp_failed(email_id: int) -> None:
    """Mark NLP processing as failed."""
    db = await get_db()
    await db.execute(
        "UPDATE emails SET nlp_status = 'failed' WHERE id = ?",
        (email_id,)
    )
    await db.commit()


async def get_nlp_results(message_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Get NLP enrichment results for given message IDs.
    Returns dict: message_id -> result dict."""
    if not message_ids:
        return {}
    import json
    db = await get_db()
    placeholders = ','.join('?' * len(message_ids))
    cursor = await db.execute(f"""
        SELECT message_id, nlp_status, nlp_result
        FROM emails
        WHERE message_id IN ({placeholders})
        AND nlp_status = 'completed'
    """, message_ids)
    rows = await cursor.fetchall()
    results = {}
    for row in rows:
        result = json.loads(row["nlp_result"]) if row["nlp_result"] else {}
        results[row["message_id"]] = result
    return results


async def get_nlp_queue_stats() -> Dict[str, int]:
    """Get counts of emails in each NLP status."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT nlp_status, COUNT(*) as count
        FROM emails
        GROUP BY nlp_status
    """)
    rows = await cursor.fetchall()
    stats = {"pending": 0, "processing": 0, "completed": 0, "failed": 0, "skipped": 0}
    for row in rows:
        status = row["nlp_status"] or "pending"
        if status in stats:
            stats[status] = row["count"]
    return stats


async def run_migration_002():
    """Apply migration 002: add background NLP columns."""
    db = await get_db()
    # Check if columns already exist
    cursor = await db.execute("PRAGMA table_info(emails)")
    columns = [row["name"] for row in await cursor.fetchall()]
    
    if "nlp_status" not in columns:
        logger.info("Applying migration 002: adding NLP background columns")
        await db.execute("ALTER TABLE emails ADD COLUMN nlp_status TEXT DEFAULT 'pending'")
        await db.execute("ALTER TABLE emails ADD COLUMN nlp_result TEXT")
        await db.execute("ALTER TABLE emails ADD COLUMN nlp_enriched_at TEXT")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_emails_nlp_status ON emails(nlp_status)")
        await db.commit()
        logger.info("Migration 002 applied successfully")
    else:
        logger.debug("Migration 002 already applied")


async def run_migration_003():
    """Apply migration 003: cross-mailbox supplier matching."""
    db = await get_db()
    cursor = await db.execute("PRAGMA table_info(suppliers)")
    columns = [row["name"] for row in await cursor.fetchall()]

    if "folder_name_normalized" not in columns:
        logger.info("Applying migration 003: adding supplier folder name matching")
        await db.execute("ALTER TABLE suppliers ADD COLUMN folder_name_normalized TEXT")
        await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_folder_name ON suppliers(folder_name_normalized)")
        await db.execute("ALTER TABLE emails ADD COLUMN enrichment_mode TEXT DEFAULT 'BASE'")
        await db.commit()
        logger.info("Migration 003 applied successfully")
    else:
        logger.debug("Migration 003 already applied")


# ── Cross-Mailbox Supplier Matching ──

def _normalize_folder_name(name: str) -> str:
    """Normalize folder name for cross-mailbox matching.
    Strips email domains, numeric suffixes (-1, -2), Gmail prefixes."""
    if not name:
        return ""
    import re
    normalized = name.strip().upper()
    # Remove email domain suffixes like "-commercial@field-pro.ae"
    normalized = re.sub(r'-[\w.-]+@[\w.-]+\.\w+$', '', normalized)
    # Remove numeric suffixes like "-1", "-2" (Thunderbird duplicate naming)
    normalized = re.sub(r'-\d+$', '', normalized)
    # Remove Gmail prefix
    normalized = re.sub(r'^\[GMAIL\]/', '', normalized)
    return normalized


async def get_or_create_supplier_by_folder(
    folder_name: str,
    email_domain: str,
    sender_email: str,
) -> Dict[str, Any]:
    """Get existing supplier by folder name (cross-mailbox), or create new one.

    Same folder name across different mailboxes = same supplier.
    This is the core matching logic for RFQ processing.
    """
    db = await get_db()
    normalized = _normalize_folder_name(folder_name)

    if not normalized:
        # Fallback: use email domain
        normalized = email_domain.upper() if email_domain else "UNKNOWN"

    # Try 1: Exact match by normalized folder name
    cursor = await db.execute(
        "SELECT * FROM suppliers WHERE folder_name_normalized = ?",
        (normalized,)
    )
    row = await cursor.fetchone()
    if row:
        return {"supplier_id": row["id"], "action": "found", "name": row["name"]}

    # Try 2: Fuzzy match by name (for backwards compatibility)
    cursor = await db.execute(
        "SELECT * FROM suppliers WHERE UPPER(name) = ?",
        (normalized,)
    )
    row = await cursor.fetchone()
    if row:
        # Update with folder_name_normalized for future lookups
        await db.execute(
            "UPDATE suppliers SET folder_name_normalized = ? WHERE id = ?",
            (normalized, row["id"])
        )
        await db.commit()
        return {"supplier_id": row["id"], "action": "updated", "name": row["name"]}

    # Create new supplier
    # Extract a display name from the folder name (or use sender info)
    display_name = folder_name.strip()
    if not display_name or display_name.lower() in ['inbox', 'sent', 'drafts', 'trash', 'archive']:
        # Generic folder names - use domain name
        display_name = email_domain.split('.')[0].upper() if email_domain else "Unknown Supplier"

    cursor = await db.execute("""
        INSERT INTO suppliers (name, email_domain, contact_email, folder_name_normalized)
        VALUES (?, ?, ?, ?)
    """, (display_name, email_domain, sender_email, normalized))
    await db.commit()
    supplier_id = cursor.lastrowid
    logger.info("[SUPPLIER] Created new supplier: id=%d, name=%s, folder=%s",
                supplier_id, display_name, normalized)
    return {"supplier_id": supplier_id, "action": "created", "name": display_name}


async def get_supplier_emails(supplier_id: int, limit: int = 100) -> List[Dict[str, Any]]:
    """Get all emails for a supplier (across all mailboxes)."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT * FROM emails
        WHERE supplier_id = ?
        ORDER BY sent_at DESC
        LIMIT ?
    """, (supplier_id, limit))
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]


async def list_suppliers_with_stats() -> List[Dict[str, Any]]:
    """List all suppliers with email counts (across all mailboxes)."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT
            s.id, s.name, s.email_domain, s.contact_email,
            s.folder_name_normalized, s.open_rfq_count,
            COUNT(e.id) as total_emails,
            SUM(CASE WHEN e.nlp_status = 'completed' THEN 1 ELSE 0 END) as enriched_emails
        FROM suppliers s
        LEFT JOIN emails e ON e.supplier_id = s.id
        GROUP BY s.id
        ORDER BY s.name
    """)
    rows = await cursor.fetchall()
    return [dict(row) for row in rows]
