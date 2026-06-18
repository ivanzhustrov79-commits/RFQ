import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

for eid in [414, 2619]:
    row = db.execute("""
        SELECT id, subject, body_text, length(body_text) as body_len
        FROM emails WHERE id = ?
    """, (eid,)).fetchone()
    print(f"=== id={eid} ===")
    print(f"subject: {row['subject']!r}")
    print(f"body_len: {row['body_len']}")
    print(f"body_text sample: {row['body_text'][:300]!r}")
    print()

db.close()
