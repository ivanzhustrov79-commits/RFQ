import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

# Check supplier 1 (NINGBO COOL) threads
print("=== NINGBO COOL threads ===")
rows = db.execute("""
    SELECT t.id, t.subject_prefix,
           COUNT(e.id) as email_count
    FROM threads t
    LEFT JOIN emails e ON e.thread_id = t.id
    WHERE t.supplier_id = 1
    GROUP BY t.id
""").fetchall()
for r in rows:
    print(f"  thread {r['id']}: '{r['subject_prefix']}' = {r['email_count']} emails")

# Check how many emails have thread_id set
total = db.execute("SELECT COUNT(*) FROM emails").fetchone()[0]
with_thread = db.execute("SELECT COUNT(*) FROM emails WHERE thread_id IS NOT NULL").fetchone()[0]
print(f"\nTotal emails: {total}")
print(f"With thread_id: {with_thread}")
print(f"Without thread_id: {total - with_thread}")

# Sample emails without thread_id
rows = db.execute("""
    SELECT message_id, subject, supplier_id, sent_at
    FROM emails WHERE thread_id IS NULL AND supplier_id IS NOT NULL
    LIMIT 5
""").fetchall()
if rows:
    print("\nSample emails missing thread_id:")
    for r in rows:
        print(f"  supplier={r['supplier_id']} subject='{r['subject']}'")

db.close()
