import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

rows = db.execute("SELECT id, subject FROM emails WHERE nlp_status='failed'").fetchall()
print(f"Found {len(rows)} failed emails. Resetting all to pending...")
for r in rows[:10]:
    print(f"  id={r['id']} subject={r['subject']!r}")
if len(rows) > 10:
    print(f"  ... and {len(rows)-10} more")

db.execute("UPDATE emails SET nlp_status='pending', nlp_result=NULL WHERE nlp_status='failed'")
db.commit()

remaining = db.execute("SELECT COUNT(*) FROM emails WHERE nlp_status='failed'").fetchone()[0]
print(f"\nReset complete. Remaining failed: {remaining}")

db.close()
