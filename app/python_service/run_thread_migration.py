"""
Run this from python_service/ directory:
python run_thread_migration.py
"""
import asyncio
import sqlite3
import re

DB_PATH = 'data/rfq_flow.db'


def extract_subject_prefix(subject: str, words: int = 4) -> str:
    """Clean subject line and extract prefix for thread grouping."""
    if not subject:
        return "(no subject)"
    
    # Remove reply/forward prefixes repeatedly (including Chinese 回复/转发)
    cleaned = subject
    while True:
        prev = cleaned
        cleaned = re.sub(r'^(Re|Fwd|Fw|Re\[\d+\]|回复|转发)[\s:：]+', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'^\[.*?\]\s*', '', cleaned)
        cleaned = cleaned.strip()
        if cleaned == prev:
            break
    
    if not cleaned:
        cleaned = subject.strip()
    
    # Remove encoding artifacts - strip trailing garbled text after " -" or "--"
    # e.g. "AGCO compressors -ÑÐµÑÐ¸Ð²ÐµÑ-" → "AGCO compressors"
    cleaned = re.sub(r'\s*[-–—]+\s*[^\x00-\x7F\s][^\x00-\x7F]*.*$', '', cleaned).strip()
    # Also strip trailing "-Лена", "-Elena" type suffixes (person name tags)
    cleaned = re.sub(r'\s*-\s*[A-ZА-Я][a-zа-яё]{2,}$', '', cleaned).strip()
    
    if not cleaned:
        cleaned = subject.strip()
    
    # First N words
    prefix = ' '.join(cleaned.split()[:words])
    return prefix[:60]


def run():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    # Migration 006 - create tables
    print("[006] Creating threads table...")
    db.execute("""
        CREATE TABLE IF NOT EXISTS threads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL,
            subject_prefix TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
            UNIQUE(supplier_id, subject_prefix)
        )
    """)

    try:
        db.execute("ALTER TABLE emails ADD COLUMN thread_id INTEGER REFERENCES threads(id)")
        print("[006] Added thread_id column to emails")
    except Exception as e:
        if 'duplicate column' in str(e).lower():
            print("[006] thread_id column already exists")
        else:
            raise

    db.execute("CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(thread_id)")
    db.commit()
    print("[006] Migration done\n")

    # Show current state
    emails = db.execute("""
        SELECT e.id, e.message_id, e.supplier_id, e.subject, s.name as supplier_name
        FROM emails e
        LEFT JOIN suppliers s ON s.id = e.supplier_id
        WHERE e.supplier_id IS NOT NULL
        ORDER BY e.supplier_id, e.subject
    """).fetchall()

    print(f"[THREADS] Processing {len(emails)} emails with supplier_id set...\n")

    # Also grab emails where supplier_id is NULL but folder matches a supplier
    unmatched = db.execute("""
        SELECT e.id, e.message_id, e.folder_path, e.subject, s.id as supplier_id, s.name as supplier_name
        FROM emails e
        JOIN suppliers s ON UPPER(e.folder_path) = s.folder_name_normalized
        WHERE e.supplier_id IS NULL
    """).fetchall()

    if unmatched:
        print(f"[THREADS] Fixing supplier_id for {len(unmatched)} emails via folder match...")
        for row in unmatched:
            db.execute("UPDATE emails SET supplier_id=? WHERE id=?", (row['supplier_id'], row['id']))
        db.commit()

        # Re-fetch all emails with supplier_id
        emails = db.execute("""
            SELECT e.id, e.message_id, e.supplier_id, e.subject, s.name as supplier_name
            FROM emails e
            LEFT JOIN suppliers s ON s.id = e.supplier_id
            WHERE e.supplier_id IS NOT NULL
            ORDER BY e.supplier_id, e.subject
        """).fetchall()
        print(f"[THREADS] Now processing {len(emails)} emails total\n")

    # Reset existing threads for clean re-run
    db.execute("UPDATE emails SET thread_id = NULL")
    db.execute("DELETE FROM threads")
    db.commit()
    print("[THREADS] Reset existing threads for clean re-run\n")

    thread_map = {}  # (supplier_id, prefix) -> thread_id

    for email in emails:
        supplier_id = email['supplier_id']
        subject = email['subject'] or '(no subject)'
        prefix = extract_subject_prefix(subject)
        key = (supplier_id, prefix)

        if key not in thread_map:
            db.execute("""
                INSERT OR IGNORE INTO threads (supplier_id, subject_prefix)
                VALUES (?, ?)
            """, (supplier_id, prefix))
            db.commit()

            row = db.execute("""
                SELECT id FROM threads WHERE supplier_id=? AND subject_prefix=?
            """, (supplier_id, prefix)).fetchone()

            thread_id = row['id'] if row else None
            thread_map[key] = thread_id
        else:
            thread_id = thread_map[key]

        if thread_id:
            db.execute("UPDATE emails SET thread_id=? WHERE id=?", (thread_id, email['id']))

    db.commit()
    print(f"[THREADS] Created {len(thread_map)} threads\n")

    # Show results grouped by supplier
    suppliers = db.execute("SELECT id, name FROM suppliers ORDER BY name").fetchall()
    for s in suppliers:
        threads = db.execute("""
            SELECT t.subject_prefix, COUNT(e.id) as cnt,
                   MIN(e.step_assigned) as min_step,
                   MAX(e.step_assigned) as max_step
            FROM threads t
            LEFT JOIN emails e ON e.thread_id = t.id
            WHERE t.supplier_id = ?
            GROUP BY t.id
            ORDER BY cnt DESC
        """, (s['id'],)).fetchall()

        if threads:
            print(f"=== {s['name']} ({len(threads)} threads) ===")
            for t in threads:
                print(f"  [{t['cnt']} emails, steps {t['min_step']}→{t['max_step']}] {t['subject_prefix']}")
            print()

    db.close()
    print("[DONE] Thread migration complete")


if __name__ == '__main__':
    run()
