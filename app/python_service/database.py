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
