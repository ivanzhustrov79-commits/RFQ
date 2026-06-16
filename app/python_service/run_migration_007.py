"""
Run from python_service/:
python run_migration_007.py
"""
import sqlite3

DB_PATH = 'data/rfq_flow.db'

def run():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    print("[007] Creating trusted_senders table...")
    db.execute("""
        CREATE TABLE IF NOT EXISTS trusted_senders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            sender_type TEXT NOT NULL CHECK(sender_type IN ('self','boss')),
            display_name TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    # Add sender_type column to emails
    try:
        db.execute("ALTER TABLE emails ADD COLUMN sender_type TEXT DEFAULT NULL")
        print("[007] Added sender_type column to emails")
    except Exception as e:
        if 'duplicate column' in str(e).lower():
            print("[007] sender_type column already exists")
        else:
            raise

    db.execute("CREATE INDEX IF NOT EXISTS idx_emails_sender_type ON emails(sender_type)")
    db.commit()

    # Insert trusted senders
    trusted = [
        ('izhustrov@import-detal36.ru', 'self', 'Ivan'),
        ('izhustrov@europa-parts.kz', 'self', 'Ivan'),
        ('commercial@field-pro.ae', 'self', 'Ivan'),
        ('vlebedinets@agro-pro2014.ru', 'boss', 'Boss'),
        ('vlebedev@import-detal36.ru', 'boss', 'Boss'),
        ('info@field-pro.ae', 'boss', 'Boss'),
    ]

    for email, sender_type, name in trusted:
        db.execute("""
            INSERT OR IGNORE INTO trusted_senders (email, sender_type, display_name)
            VALUES (?, ?, ?)
        """, (email, sender_type, name))

    db.commit()
    print(f"[007] Inserted {len(trusted)} trusted senders")

    # Now classify existing emails
    print("[007] Classifying existing emails by sender_type...")

    # Get all trusted sender emails
    self_emails = [r[0] for r in db.execute("SELECT email FROM trusted_senders WHERE sender_type='self'").fetchall()]
    boss_emails = [r[0] for r in db.execute("SELECT email FROM trusted_senders WHERE sender_type='boss'").fetchall()]

    # Get supplier contact emails
    supplier_emails = [r[0] for r in db.execute("SELECT email_pattern FROM supplier_contact_emails").fetchall()]
    supplier_domains = [e.lstrip('@') for e in supplier_emails if e.startswith('@')]
    supplier_exact = [e for e in supplier_emails if not e.startswith('@')]

    # Reset existing classifications for clean re-run
    db.execute("UPDATE emails SET sender_type = NULL")
    db.commit()

    # Classify all emails
    all_emails = db.execute("SELECT id, sender_email FROM emails").fetchall()

    counts = {'self': 0, 'boss': 0, 'supplier': 0, 'auxiliary': 0}

    def extract_email(raw):
        """Extract bare email from 'Display Name <email>' or plain email."""
        if not raw:
            return ''
        raw = raw.strip()
        if '<' in raw and '>' in raw:
            return raw[raw.rfind('<')+1:raw.rfind('>')].strip().lower()
        return raw.lower()

    self_set = {e.lower() for e in self_emails}
    boss_set = {e.lower() for e in boss_emails}
    supplier_exact_set = {e.lower() for e in supplier_exact}

    for row in all_emails:
        sender = extract_email(row['sender_email'])
        if not sender:
            continue

        if sender in self_set:
            stype = 'self'
        elif sender in boss_set:
            stype = 'boss'
        elif sender in supplier_exact_set:
            stype = 'supplier'
        elif any(sender.endswith('@' + d.lower()) for d in supplier_domains):
            stype = 'supplier'
        else:
            stype = 'auxiliary'

        db.execute("UPDATE emails SET sender_type=? WHERE id=?", (stype, row['id']))
        counts[stype] += 1

    db.commit()

    print(f"\n=== Sender classification results ===")
    for stype, count in counts.items():
        print(f"  {stype}: {count} emails")

    total = sum(counts.values())
    print(f"  Total classified: {total}")

    # Show sample auxiliary emails to verify
    aux_sample = db.execute("""
        SELECT sender_email, subject FROM emails
        WHERE sender_type='auxiliary'
        LIMIT 5
    """).fetchall()
    if aux_sample:
        print("\nSample auxiliary emails:")
        for r in aux_sample:
            print(f"  {r['sender_email']}: {r['subject']}")

    db.close()
    print("\n[DONE] Migration 007 complete")

if __name__ == '__main__':
    run()
