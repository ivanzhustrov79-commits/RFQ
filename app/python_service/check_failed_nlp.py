import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

rows = db.execute("""
    SELECT id, message_id, subject, sender_email, nlp_status, nlp_result
    FROM emails WHERE nlp_status = 'failed'
""").fetchall()

print(f"=== {len(rows)} failed emails ===\n")
for r in rows:
    print(dict(r))

db.close()
