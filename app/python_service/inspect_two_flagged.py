import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

for eid in [1218, 784]:
    row = db.execute("""
        SELECT id, subject, sender_email, body_text, length(body_text) as body_len
        FROM emails WHERE id = ?
    """, (eid,)).fetchone()
    print(f"=== id={eid} ===")
    print(f"subject: {row['subject']!r}")
    print(f"sender: {row['sender_email']!r}")
    print(f"body_len: {row['body_len']}")
    print(f"FULL body_text (repr):")
    print(repr(row['body_text']))
    print()

db.close()
