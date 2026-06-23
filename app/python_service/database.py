"""RFQ Flow Python Service - SQLite Database Layer"""
import aiosqlite
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
import logging
import sqlite3

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
    import re
    import json

    db = await get_db()

    # Module-level thread cache: (supplier_id, prefix) -> thread_id
    # Avoids repeated DB lookups during bulk import
    if not hasattr(upsert_email, '_thread_cache'):
        upsert_email._thread_cache = {}

    # ------------------------------------------------------------------
    # Reply-chain thread resolution (runs BEFORE subject-prefix fallback)
    # ------------------------------------------------------------------
    # In-Reply-To / References give a near-zero-ambiguity signal: if this
    # email is a reply to a specific prior Message-ID we already have in
    # the DB, inherit that email's thread_id directly — far more reliable
    # than guessing from subject text. Subject-prefix matching only runs
    # as a fallback when no reply-chain match is found (new conversation,
    # or the parent email hasn't synced/was skipped).
    if not data.get("thread_id"):
        candidate_message_ids = []

        in_reply_to = (data.get("in_reply_to") or "").strip()
        if in_reply_to:
            candidate_message_ids.append(in_reply_to)

        references_list = data.get("references") or []
        if references_list:
            # References lists the whole ancestor chain, oldest-first per
            # RFC 5322 — the immediate parent is the LAST entry. Check
            # nearest-ancestor-first so we prefer the closest match.
            for ref_id in reversed(references_list):
                if ref_id not in candidate_message_ids:
                    candidate_message_ids.append(ref_id)

        # Capped one-time diagnostic (first 20 only, then silent) — same
        # pattern as the existing MID-DIAG/PUSH-DIAG logs — confirms whether
        # reply-chain matching is actually firing in practice.
        if not hasattr(upsert_email, '_thread_resolve_diag_count'):
            upsert_email._thread_resolve_diag_count = 0

        matched_via_reply_chain = False
        for candidate_id in candidate_message_ids:
            parent_row = await db.execute(
                "SELECT thread_id FROM emails WHERE message_id = ?",
                (candidate_id,)
            )
            parent = await parent_row.fetchone()
            if parent and parent["thread_id"] is not None:
                data["thread_id"] = parent["thread_id"]
                matched_via_reply_chain = True
                break
            # No match (or parent exists but isn't itself thread-resolved
            # yet) — try the next candidate, then fall through to the
            # subject-prefix block below if none match at all.

        if upsert_email._thread_resolve_diag_count < 20:
            if matched_via_reply_chain:
                logger.info(
                    "[THREAD-RESOLVE-DIAG] %s matched via reply-chain -> thread_id=%s",
                    data.get("message_id"), data.get("thread_id"),
                )
            elif candidate_message_ids:
                logger.info(
                    "[THREAD-RESOLVE-DIAG] %s had reply-chain headers but no match found "
                    "(parent not yet synced) -> falling to subject-prefix",
                    data.get("message_id"),
                )
            else:
                logger.info(
                    "[THREAD-RESOLVE-DIAG] %s had no in_reply_to/references at all "
                    "-> falling to subject-prefix",
                    data.get("message_id"),
                )
            upsert_email._thread_resolve_diag_count += 1

    # Auto-resolve thread_id from subject + supplier_id if not provided
    if not data.get("thread_id") and data.get("supplier_id") and data.get("subject"):
        supplier_id = data["supplier_id"]
        subject = data["subject"]

        # Clean subject to get prefix
        cleaned = subject
        while True:
            prev = cleaned
            cleaned = re.sub(r'^(Re|Fwd|Fw|Re\[\d+\]|回复|转发)[\s:：]+', '', cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r'^\[.*?\]\s*', '', cleaned)
            cleaned = cleaned.strip()
            if cleaned == prev:
                break
        cleaned = re.sub(r'\s*[-–—]+\s*[^\x00-\x7F\s][^\x00-\x7F]*.*$', '', cleaned).strip()
        cleaned = re.sub(r'\s*-\s*[A-ZА-Я][a-zа-яё]{2,}$', '', cleaned).strip()
        if not cleaned:
            cleaned = subject.strip()
        prefix = ' '.join(cleaned.split()[:4])[:60]

        cache_key = (supplier_id, prefix)

        if cache_key in upsert_email._thread_cache:
            data["thread_id"] = upsert_email._thread_cache[cache_key]
        else:
            # Look up thread in DB
            row = await db.execute(
                "SELECT id FROM threads WHERE supplier_id=? AND subject_prefix=?",
                (supplier_id, prefix)
            )
            thread_row = await row.fetchone()

            if thread_row:
                thread_id = thread_row["id"]
            else:
                # Create new thread
                cursor = await db.execute(
                    "INSERT OR IGNORE INTO threads (supplier_id, subject_prefix) VALUES (?,?)",
                    (supplier_id, prefix)
                )
                await db.commit()
                if cursor.lastrowid:
                    thread_id = cursor.lastrowid
                else:
                    row = await db.execute(
                        "SELECT id FROM threads WHERE supplier_id=? AND subject_prefix=?",
                        (supplier_id, prefix)
                    )
                    thread_row = await row.fetchone()
                    thread_id = thread_row["id"] if thread_row else None

            upsert_email._thread_cache[cache_key] = thread_id
            data["thread_id"] = thread_id

    # Auto-resolve sender_type if not provided
    if not data.get("sender_type") and data.get("sender_email"):
        import re as _re
        raw = data["sender_email"].strip()
        m = _re.search(r'<([^>]+)>', raw)
        bare = m.group(1).lower() if m else raw.lower()

        if not hasattr(upsert_email, '_sender_cache'):
            upsert_email._sender_cache = {}

        if bare in upsert_email._sender_cache:
            data["sender_type"] = upsert_email._sender_cache[bare]
        else:
            # Check trusted senders
            ts = await db.execute(
                "SELECT sender_type FROM trusted_senders WHERE LOWER(email)=?", (bare,)
            )
            ts_row = await ts.fetchone()
            if ts_row:
                stype = ts_row["sender_type"]
            else:
                # Check supplier contact emails
                sc = await db.execute(
                    "SELECT id FROM supplier_contact_emails WHERE LOWER(email_pattern)=? OR LOWER(email_pattern)=?",
                    (bare, '@' + bare.split('@')[-1])
                )
                sc_row = await sc.fetchone()
                stype = 'supplier' if sc_row else 'auxiliary'

            upsert_email._sender_cache[bare] = stype
            data["sender_type"] = stype

    # NOTE: supplier_id is now ALWAYS resolved by Electron before calling this endpoint,
    # purely via sender/recipient address matching against supplier_contact_emails.
    # Folder-name-based supplier resolution has been removed entirely — folder location
    # in the mail client carries no meaning for this app anymore. If supplier_id is still
    # not provided (e.g. sender matched no known supplier), it stays NULL, which is correct.


    # Check if exists
    cursor = await db.execute(
        "SELECT id FROM emails WHERE message_id = ?",
        (data.get("message_id"),)
    )
    existing = await cursor.fetchone()

    if existing:
        # Update metadata only — never overwrite NLP results, step_assigned, or supplier_id
        # if they were already set by SMART mode
        await db.execute("""
            UPDATE emails SET
                profile_name = ?, account_email = ?, folder_path = ?,
                subject = ?, sender_email = ?, sender_name = ?,
                sent_at = ?, body_language = ?,
                has_attachments = ?,
                thread_id = CASE WHEN thread_id IS NULL THEN ? ELSE thread_id END,
                body_text = ?,
                supplier_id = CASE WHEN supplier_id IS NULL THEN ? ELSE supplier_id END,
                sender_type = CASE WHEN sender_type IS NULL THEN ? ELSE sender_type END,
                step_assigned = CASE WHEN nlp_status IN ('completed','manual') THEN step_assigned ELSE ? END,
                in_reply_to = ?, references_header = ?,
                parsed_at = datetime('now')
            WHERE message_id = ?
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("subject"), data.get("sender_email"), data.get("sender_name"),
            data.get("sent_at"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"),
            data.get("body_text"),
            data.get("supplier_id"),
            data.get("sender_type"),
            data.get("step_assigned", 0),
            data.get("in_reply_to"), json.dumps(data.get("references") or []),
            data.get("message_id"),
        ))
        await db.commit()
        return {"email_id": existing["id"], "action": "updated"}

    # Insert
    try:
        cursor = await db.execute("""
            INSERT INTO emails (
                profile_name, account_email, folder_path, message_id,
                subject, sender_email, sender_name, sent_at,
                body_text, body_language, has_attachments, thread_id,
                step_assigned, rfq_id, supplier_id, sender_type,
                in_reply_to, references_header
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("message_id"), data.get("subject"),
            data.get("sender_email"), data.get("sender_name"), data.get("sent_at"),
            data.get("body_text"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"), data.get("step_assigned", 0),
            data.get("rfq_id"), data.get("supplier_id"), data.get("sender_type"),
            data.get("in_reply_to"), json.dumps(data.get("references") or []),
        ))
        await db.commit()
        return {"email_id": cursor.lastrowid, "action": "inserted"}

    except sqlite3.IntegrityError as e:
        if "UNIQUE constraint failed: emails.message_id" not in str(e):
            raise  # a different integrity error — don't mask it, something else is wrong

        # Lost the race: another concurrent call (same Promise.all batch, or an
        # overlapping batch) inserted this message_id between our SELECT and our
        # INSERT. The row legitimately exists now — we just didn't see it in time.
        # Fall through to the same UPDATE logic as the normal "already exists" path
        # rather than surfacing this as a DB_ERROR.
        await db.execute("""
            UPDATE emails SET
                profile_name = ?, account_email = ?, folder_path = ?,
                subject = ?, sender_email = ?, sender_name = ?,
                sent_at = ?, body_language = ?,
                has_attachments = ?,
                thread_id = CASE WHEN thread_id IS NULL THEN ? ELSE thread_id END,
                body_text = ?,
                supplier_id = CASE WHEN supplier_id IS NULL THEN ? ELSE supplier_id END,
                sender_type = CASE WHEN sender_type IS NULL THEN ? ELSE sender_type END,
                step_assigned = CASE WHEN nlp_status IN ('completed','manual') THEN step_assigned ELSE ? END,
                in_reply_to = ?, references_header = ?,
                parsed_at = datetime('now')
            WHERE message_id = ?
        """, (
            data.get("profile_name"), data.get("account_email"), data.get("folder_path"),
            data.get("subject"), data.get("sender_email"), data.get("sender_name"),
            data.get("sent_at"), data.get("body_language"),
            1 if data.get("has_attachments") else 0,
            data.get("thread_id"),
            data.get("body_text"),
            data.get("supplier_id"),
            data.get("sender_type"),
            data.get("step_assigned", 0),
            data.get("in_reply_to"), json.dumps(data.get("references") or []),
            data.get("message_id"),
        ))
        await db.commit()

        row_cursor = await db.execute(
            "SELECT id FROM emails WHERE message_id = ?",
            (data.get("message_id"),)
        )
        row = await row_cursor.fetchone()
        return {"email_id": row["id"] if row else None, "action": "updated_after_race"}


STEP_NAMES = {0: "PR", 1: "RFQ", 2: "CI", 3: "Downpayment"}


async def compute_step_color(thread_id, step: int) -> Dict[str, Any]:
    """
    Implements the step-color redesign spec, sections 3.2 (color rule) and
    3.3 (list ordering), for ONE step within ONE thread.

    thread_id is used as the practical "one RFQ/deal" unit — rfq_id is not
    yet populated/wired up anywhere in this codebase (confirmed: no code
    writes to it), so thread_id is what already groups one conversation's
    emails together in practice.

    Color rule (spec 3.2):
      - zero emails in this step -> white
      - emails exist, but none are advances/holds (all neutral, including
        NULL/unclassified, which is treated identically to neutral) -> yellow
      - otherwise, the MOST RECENT advances/holds email decides: advances ->
        green, holds -> yellow. This is what makes green "sticky": ordinary
        neutral correspondence (including a high volume of routine supplier
        chatter) can never move a green step back to yellow — only a new
        holds email can, and a new advances email after a hold was lifted
        correctly flips it back to green.
      - Step 0 (PR) never participates in this system at all -> always white,
        regardless of email count or content (enforced in pipeline.py's
        classifier too, but enforced here as well since this is the
        authoritative read path).

    List ordering rule (spec 3.3):
      - signal stack first (all advances/holds emails, most recent first —
        if the step's status flipped back and forth multiple times, ALL of
        those signal emails stay stacked at the top, not just the latest one)
      - then all neutral emails, in normal chronological order
      - the single most recent signal email is always the very top entry
    """
    db = await get_db()

    cursor = await db.execute("""
        SELECT id, subject, sender_email, sent_at, signal_type
        FROM emails WHERE thread_id = ? AND step_assigned = ?
        ORDER BY sent_at ASC
    """, (str(thread_id), step))
    emails = [dict(r) for r in await cursor.fetchall()]

    if step == 0 or not emails:
        return {
            "step": step,
            "step_name": STEP_NAMES.get(step, f"Step {step}"),
            "color": "white",
            "top_email_id": None,
            "emails": emails,
        }

    signal_emails = [e for e in emails if e["signal_type"] in ("advances", "holds")]
    neutral_emails = [e for e in emails if e["signal_type"] not in ("advances", "holds")]

    # Signal stack: most recent first (NOT just the single latest — every
    # signal email stays visible, per spec 3.3's "key stack" requirement).
    signal_emails.sort(key=lambda e: e["sent_at"], reverse=True)
    # Remainder: normal chronological order (oldest first, matching the
    # existing default email-list sort used elsewhere in this app).
    neutral_emails.sort(key=lambda e: e["sent_at"])

    ordered_emails = signal_emails + neutral_emails

    if not signal_emails:
        return {
            "step": step,
            "step_name": STEP_NAMES.get(step, f"Step {step}"),
            "color": "yellow",
            "top_email_id": None,
            "emails": ordered_emails,
        }

    most_recent_signal = signal_emails[0]
    color = "green" if most_recent_signal["signal_type"] == "advances" else "yellow"

    return {
        "step": step,
        "step_name": STEP_NAMES.get(step, f"Step {step}"),
        "color": color,
        "top_email_id": most_recent_signal["id"],
        "emails": ordered_emails,
    }


async def get_thread_step_statuses(thread_id) -> List[Dict[str, Any]]:
    """Returns compute_step_color's result for all 4 steps (PR/RFQ/CI/
    Downpayment) for one thread — one call covers everything a Kanban
    RFQ-card needs to render, rather than 4 separate round-trips."""
    return [await compute_step_color(thread_id, step) for step in range(4)]


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
    Only queues emails that haven't been completed or manually overridden."""
    db = await get_db()
    placeholders = ','.join('?' * len(message_ids))
    await db.execute(f"""
        UPDATE emails SET nlp_status = 'pending'
        WHERE message_id IN ({placeholders})
        AND (nlp_status IS NULL OR nlp_status NOT IN ('completed', 'manual'))
    """, message_ids)
    await db.commit()
    cursor = await db.execute(
        f"SELECT COUNT(*) as c FROM emails WHERE message_id IN ({placeholders}) AND nlp_status = 'pending'",
        message_ids
    )
    row = await cursor.fetchone()
    return row["c"] if row else 0


async def get_next_nlp_pending() -> Optional[Dict[str, Any]]:
    """Get the next email waiting for LLM enrichment.
    Skips 'manual' rows and auto-recovers rows stuck in 'processing' > 10 min."""
    db = await get_db()
    await db.execute("""
        UPDATE emails SET nlp_status = 'pending'
        WHERE nlp_status = 'processing'
        AND nlp_enriched_at IS NULL
        AND parsed_at < datetime('now', '-10 minutes')
    """)
    await db.commit()
    cursor = await db.execute("""
        SELECT id, message_id, subject, body_text, sender_email, account_email,
               body_language, supplier_id, thread_id
        FROM emails
        WHERE nlp_status = 'pending'
        ORDER BY sent_at ASC
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
    step = result.get("step")
    signal_type = result.get("signal_type", "neutral")
    if signal_type not in ("advances", "holds", "neutral"):
        signal_type = "neutral"

    if step is not None and isinstance(step, int) and 0 <= step <= 3:
        await db.execute("""
            UPDATE emails SET
                nlp_status = 'completed',
                nlp_result = ?,
                nlp_enriched_at = datetime('now'),
                step_assigned = ?,
                signal_type = ?
            WHERE id = ?
        """, (json.dumps(result), step, signal_type, email_id))
    else:
        await db.execute("""
            UPDATE emails SET
                nlp_status = 'completed',
                nlp_result = ?,
                nlp_enriched_at = datetime('now'),
                signal_type = ?
            WHERE id = ?
        """, (json.dumps(result), signal_type, email_id))
    await db.commit()

    # Part-number reconciliation runs AFTER the main save, since part numbers
    # are only known now (post-NLP) — never at sync time. Wrapped defensively:
    # a bug in this newer, more experimental piece must never take down NLP
    # processing itself, which is the part of the pipeline everything else
    # depends on.
    try:
        part_numbers = result.get("part_numbers") or []
        if part_numbers:
            row_cursor = await db.execute(
                "SELECT supplier_id, thread_id, message_id, sent_at FROM emails WHERE id = ?",
                (email_id,)
            )
            row = await row_cursor.fetchone()
            if row:
                await reconcile_thread_by_part_numbers(
                    db, email_id, row["message_id"], row["supplier_id"],
                    row["thread_id"], row["sent_at"], part_numbers,
                )
    except Exception as e:
        logger.warning("[PART-MERGE] reconciliation failed for email_id=%s: %s", email_id, e)


# Pragmatic stand-in for the real signal (whether the prior RFQ is already
# approved/closed) until rfq_id/rfqs.status is actually wired up to threads —
# that work is deferred. A shared part number alone is NOT reliable evidence
# of "same RFQ": the same part is routinely reordered from the same supplier
# across separate, sequential deals months apart. Restricting matches to
# within this many days of the candidate thread's most recent matching part
# avoids merging genuinely separate reorders together. Revisit once RFQ
# approval/closed status is available as a real signal instead of a time
# heuristic.
MERGE_TIME_WINDOW_DAYS = 45


async def reconcile_thread_by_part_numbers(
    db, email_id: int, message_id: Optional[str], supplier_id: Optional[int],
    thread_id, sent_at: Optional[str], part_numbers: List[Dict[str, Any]],
) -> None:
    """
    Called after an email's NLP extraction completes (see save_nlp_result).
    For each extracted part number, checks whether the same supplier already
    has that part number attached to a DIFFERENT thread, within
    MERGE_TIME_WINDOW_DAYS of this email — if so, merges this email's current
    thread into that other thread, using the exact same mechanism main.py's
    analyze_thread_merges already uses for LLM-judged merges (UPDATE emails
    SET thread_id..., UPDATE threads SET merged_into_thread_id...).

    Always records the extracted parts into the `parts` table regardless of
    whether a merge fires — this is what feeds the matching index for future
    emails to compare against.
    """
    if not supplier_id or not thread_id or not part_numbers:
        return

    import json as _json
    thread_id_str = str(thread_id)
    merge_target = None
    merge_part_number = None

    for p in part_numbers:
        # Same historical-shape inconsistency as backfill_parts.py: older
        # extractions (BASE heuristic mode, earlier pipeline versions) stored
        # part_numbers as bare strings, not {"part_number": ...} dicts.
        if isinstance(p, dict):
            part_number = str(p.get("part_number") or "").strip()
            description = p.get("description")
            quantity = p.get("quantity")
            unit_price = p.get("unit_price")
            currency = p.get("currency")
        elif isinstance(p, str):
            part_number = p.strip()
            description = None
            quantity = None
            unit_price = None
            currency = None
        else:
            continue

        if not part_number:
            continue

        if merge_target is None:
            # Look for this part number under a DIFFERENT thread, same
            # supplier, within the time window — nearest match wins.
            cursor = await db.execute("""
                SELECT thread_id FROM parts
                WHERE supplier_id = ? AND part_number = ? AND thread_id IS NOT NULL
                  AND thread_id != ?
                  AND email_sent_at IS NOT NULL AND ? IS NOT NULL
                  AND ABS(julianday(?) - julianday(email_sent_at)) <= ?
                ORDER BY email_sent_at DESC
                LIMIT 1
            """, (supplier_id, part_number, thread_id_str, sent_at, sent_at, MERGE_TIME_WINDOW_DAYS))
            match = await cursor.fetchone()
            if match:
                merge_target = match["thread_id"]
                merge_part_number = part_number

        # Always record this part, whether or not it triggered a merge —
        # feeds the matching index for future emails to compare against.
        await db.execute("""
            INSERT INTO parts (supplier_id, thread_id, message_id, part_number,
                                description, quantity, price, currency, email_sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            supplier_id, thread_id_str, message_id, part_number,
            description, quantity, unit_price,
            currency, sent_at,
        ))

    await db.commit()

    if merge_target and str(merge_target) != thread_id_str:
        await db.execute("UPDATE emails SET thread_id = ? WHERE thread_id = ?", (merge_target, thread_id_str))
        await db.execute("""
            UPDATE threads SET merged_into_thread_id = ?, merge_confidence = 1.0,
                                merge_status = 'auto_merged', merge_reason = ?
            WHERE id = ?
        """, (merge_target, f"shared part_number {merge_part_number} within {MERGE_TIME_WINDOW_DAYS} days", thread_id_str))
        # Keep the parts index itself consistent — rows just inserted (or
        # already existing) under the now-merged thread should point at the
        # target thread, so future lookups see one unified history.
        await db.execute("UPDATE parts SET thread_id = ? WHERE thread_id = ?", (merge_target, thread_id_str))
        await db.commit()

        # Audit trail, per the agreed approach: thread-merge decisions reuse
        # learned_rules/rule_corrections with a deterministic pair-key
        # condition_pattern — keyword-overlap matching (used for step/
        # significance rules) doesn't apply to a decision about two specific
        # threads, so this is looked up/recorded by pair key, not keywords.
        try:
            a, b = sorted([int(thread_id_str), int(merge_target)])
            pair_key = f"thread_pair:{a}:{b}"
        except (ValueError, TypeError):
            pair_key = f"thread_pair:{thread_id_str}:{merge_target}"

        await db.execute("""
            INSERT INTO learned_rules (
                rule_type, supplier_id, condition_pattern, condition_keywords,
                action, confidence, times_confirmed, source_examples
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        """, (
            "thread_merge", supplier_id, pair_key, _json.dumps([]),
            f"merge_into={merge_target}", 1.0,
            _json.dumps([message_id] if message_id else []),
        ))
        await db.commit()

        logger.info(
            "[PART-MERGE] thread %s merged into %s via shared part_number %s (supplier_id=%s, email_id=%s)",
            thread_id_str, merge_target, merge_part_number, supplier_id, email_id,
        )


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
    Returns dict: message_id -> result dict including supplier_id."""
    if not message_ids:
        return {}
    import json
    db = await get_db()
    placeholders = ','.join('?' * len(message_ids))
    cursor = await db.execute(f"""
        SELECT message_id, nlp_status, nlp_result, supplier_id, step_assigned
        FROM emails
        WHERE message_id IN ({placeholders})
        AND nlp_status IN ('completed', 'manual')
    """, message_ids)
    rows = await cursor.fetchall()
    results = {}
    for row in rows:
        result = json.loads(row["nlp_result"]) if row["nlp_result"] else {}
        # Always include supplier_id and step_assigned from DB (authoritative)
        result["supplier_id"] = row["supplier_id"]
        result["step"] = row["step_assigned"]
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
    stats = {"pending": 0, "processing": 0, "completed": 0, "failed": 0, "skipped": 0, "manual": 0}
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


async def reset_stuck_processing() -> int:
    """Reset emails stuck in 'processing' back to 'pending'. Call on startup."""
    db = await get_db()
    await db.execute("UPDATE emails SET nlp_status = 'pending' WHERE nlp_status = 'processing'")
    await db.commit()
    count = db.total_changes
    if count:
        logger.info("[DB] Reset %d stuck 'processing' emails back to 'pending'", count)
    return count


async def run_migration_004():
    """Migration 004: sender-based supplier matching via supplier_contact_emails table."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='supplier_contact_emails'"
    )
    if await cursor.fetchone():
        return

    logger.info("Applying migration 004: supplier_contact_emails table")
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS supplier_contact_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
            email_pattern TEXT NOT NULL,
            match_type TEXT DEFAULT 'domain',
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_sce_pattern ON supplier_contact_emails(email_pattern);
        CREATE INDEX IF NOT EXISTS idx_sce_supplier ON supplier_contact_emails(supplier_id);
    """)

    suppliers = await db.execute("SELECT id, email_domain, contact_email FROM suppliers")
    rows = await suppliers.fetchall()
    for row in rows:
        sid, domain, contact = row["id"], row["email_domain"], row["contact_email"]
        if domain and domain != "unknown":
            await db.execute(
                "INSERT OR IGNORE INTO supplier_contact_emails (supplier_id, email_pattern, match_type) VALUES (?,?,?)",
                (sid, f"@{domain.lower()}", "domain")
            )
        if contact and "@" in contact:
            import re
            addr = re.search(r'[\w.+-]+@[\w.-]+\.\w+', contact)
            if addr:
                await db.execute(
                    "INSERT OR IGNORE INTO supplier_contact_emails (supplier_id, email_pattern, match_type) VALUES (?,?,?)",
                    (sid, addr.group(0).lower(), "address")
                )
    await db.commit()
    logger.info("Migration 004 applied")


async def run_migration_005():
    """Migration 005: reply-chain headers (In-Reply-To / References) for
    deterministic thread assignment — see migration_005_reply_chain.sql."""
    db = await get_db()
    cursor = await db.execute("PRAGMA table_info(emails)")
    columns = [row["name"] for row in await cursor.fetchall()]

    if "in_reply_to" not in columns:
        logger.info("Applying migration 005: adding reply-chain header columns")
        await db.execute("ALTER TABLE emails ADD COLUMN in_reply_to TEXT")
        await db.execute("ALTER TABLE emails ADD COLUMN references_header TEXT")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to)")
        await db.commit()
        logger.info("Migration 005 applied successfully")
    else:
        logger.debug("Migration 005 already applied")


async def get_boss_addresses() -> set:
    """Returns the configured Boss email addresses (lowercased), from the
    boss_addresses table (see migration 007). Used by determine_sender_role
    to recognize Boss<->user correspondence for PR/Downpayment classification."""
    db = await get_db()
    cursor = await db.execute("SELECT email FROM boss_addresses")
    rows = await cursor.fetchall()
    return set(r["email"].lower() for r in rows)


def determine_sender_role(
    sender_email: str, account_email: Optional[str],
    supplier_id: Optional[int], boss_emails: set,
) -> str:
    """
    Determines who actually sent this specific email — needed because the
    new step definitions (RFQ/CI/Downpayment) are explicitly directional
    (e.g. RFQ's 'advances' = the SUPPLIER confirming, not you sending), and
    the LLM has no way to know this from email content alone; it's a data
    fact, not something to infer from prose.

    Returns one of: "boss" | "user" | "supplier" | "unknown"

    Logic, using only data already available on the email row:
      - sender matches a configured Boss address -> "boss"
      - sender matches the account this email was synced from (i.e. you sent
        it from your own mailbox) -> "user"
      - otherwise, if a supplier_id is already resolved on this email, the
        sender is most likely that supplier (supplier_id is only ever set
        via address-matching against a known supplier contact) -> "supplier"
      - otherwise -> "unknown"
    """
    sender_lower = (sender_email or "").lower()

    if any(boss in sender_lower for boss in boss_emails):
        return "boss"

    if account_email and account_email.lower() in sender_lower:
        return "user"

    if supplier_id:
        return "supplier"

    return "unknown"


async def run_migration_007():
    """Migration 007: signal_type column (advances/holds/neutral) for the
    step-color redesign, plus a dedicated boss_addresses config table.

    Deliberately does NOT touch existing step_assigned values — that is a
    one-time, content-aware DATA transformation (old 6-step taxonomy -> new
    PR/RFQ/CI/Downpayment), not a safe additive schema change, so it lives in
    the standalone migrate_step_logic.py script instead, run manually once
    with an explicit confirmation step — never automatically at startup.
    """
    db = await get_db()
    cursor = await db.execute("PRAGMA table_info(emails)")
    columns = [row["name"] for row in await cursor.fetchall()]

    if "signal_type" not in columns:
        logger.info("Applying migration 007: adding signal_type column")
        await db.execute("ALTER TABLE emails ADD COLUMN signal_type TEXT")
        # Values: 'advances' | 'holds' | 'neutral' | NULL (unclassified —
        # treated identically to 'neutral' by the color-computation logic).
        await db.commit()

    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='boss_addresses'"
    )
    if not await cursor.fetchone():
        logger.info("Applying migration 007: creating boss_addresses table")
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS boss_addresses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                created_at TEXT DEFAULT (datetime('now'))
            );
        """)
        # Seed with the two addresses already hardcoded in main.js's
        # `bosses` array (finalizeEmail's isInternal check) — same definition
        # of "boss" the app has used all along, now made configurable.
        await db.executescript("""
            INSERT OR IGNORE INTO boss_addresses (email) VALUES
                ('info@field-pro.ae'),
                ('vlebedinets@agro-pro2014.ru');
        """)
        await db.commit()
        logger.info("Migration 007 applied successfully")
    else:
        logger.debug("Migration 007 already applied")


async def run_migration_006():
    """Migration 006: link the previously-unused parts table to threads/emails
    — see migration_006_parts_linkage.sql."""
    db = await get_db()
    cursor = await db.execute("PRAGMA table_info(parts)")
    columns = [row["name"] for row in await cursor.fetchall()]

    if "thread_id" not in columns:
        logger.info("Applying migration 006: linking parts table to threads/emails")
        await db.execute("ALTER TABLE parts ADD COLUMN thread_id TEXT")
        await db.execute("ALTER TABLE parts ADD COLUMN message_id TEXT")
        await db.execute("ALTER TABLE parts ADD COLUMN email_sent_at TEXT")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_parts_supplier_partnum ON parts(supplier_id, part_number)")
        await db.commit()
        logger.info("Migration 006 applied successfully")
    else:
        logger.debug("Migration 006 already applied")


async def get_supplier_id_by_sender(sender_email: str) -> Optional[int]:
    """Resolve supplier_id from sender email. Checks address then domain."""
    if not sender_email:
        return None
    import re
    addr_match = re.search(r'[\w.+-]+@[\w.-]+\.\w+', sender_email)
    if not addr_match:
        return None
    clean_addr = addr_match.group(0).lower()
    domain = "@" + clean_addr.split("@")[-1]
    db = await get_db()

    cursor = await db.execute(
        "SELECT supplier_id FROM supplier_contact_emails WHERE email_pattern = ? AND match_type = 'address'",
        (clean_addr,)
    )
    row = await cursor.fetchone()
    if row:
        return row["supplier_id"]

    cursor = await db.execute(
        "SELECT supplier_id FROM supplier_contact_emails WHERE email_pattern = ? AND match_type = 'domain'",
        (domain,)
    )
    row = await cursor.fetchone()
    return row["supplier_id"] if row else None


def _invalidate_email_caches():
    """
    Clear upsert_email's stale-cache risk. Must be called whenever supplier contact
    patterns, threads, or trusted_senders change — otherwise upsert_email keeps using
    pre-change classifications for the rest of the process lifetime (a real bug found
    during review: these caches never expired before, silently freezing decisions made
    before a user's correction in Settings).
    """
    if hasattr(upsert_email, '_thread_cache'):
        upsert_email._thread_cache.clear()
    if hasattr(upsert_email, '_sender_cache'):
        upsert_email._sender_cache.clear()
    logger.info("[CACHE] Cleared upsert_email thread/sender caches")


async def add_supplier_contact_email(supplier_id: int, email_pattern: str, match_type: str = "address") -> bool:
    db = await get_db()
    try:
        await db.execute(
            "INSERT OR REPLACE INTO supplier_contact_emails (supplier_id, email_pattern, match_type) VALUES (?,?,?)",
            (supplier_id, email_pattern.lower(), match_type)
        )
        await db.commit()
        _invalidate_email_caches()
        return True
    except Exception as e:
        logger.error("Failed to add contact email: %s", e)
        return False


async def get_supplier_contact_emails(supplier_id: int) -> List[Dict]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT email_pattern, match_type FROM supplier_contact_emails WHERE supplier_id = ? ORDER BY match_type, email_pattern",
        (supplier_id,)
    )
    return [dict(r) for r in await cursor.fetchall()]


async def list_suppliers_with_stats() -> List[Dict[str, Any]]:
    """List suppliers with email counts and contact patterns."""
    db = await get_db()
    cursor = await db.execute("""
        SELECT
            s.id, s.name, s.email_domain, s.open_rfq_count,
            COUNT(DISTINCT e.id) as total_emails,
            SUM(CASE WHEN e.nlp_status IN ('completed','manual') THEN 1 ELSE 0 END) as enriched_emails
        FROM suppliers s
        LEFT JOIN emails e ON e.supplier_id = s.id
        GROUP BY s.id ORDER BY s.name
    """)
    rows = await cursor.fetchall()
    result = []
    for row in rows:
        d = dict(row)
        ce = await db.execute(
            "SELECT email_pattern, match_type FROM supplier_contact_emails WHERE supplier_id = ?",
            (d["id"],)
        )
        d["contact_patterns"] = [dict(r) for r in await ce.fetchall()]
        # contact_email is now DERIVED from active patterns (source of truth),
        # not the old static suppliers.contact_email column which goes stale
        # the moment a user edits patterns in Settings.
        d["contact_email"] = d["contact_patterns"][0]["email_pattern"] if d["contact_patterns"] else None
        result.append(d)
    return result
