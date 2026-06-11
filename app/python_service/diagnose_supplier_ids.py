import sqlite3

db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

print("=== supplier_id distribution in emails ===")
rows = db.execute("""
    SELECT s.name, COUNT(e.id) as cnt
    FROM emails e
    LEFT JOIN suppliers s ON s.id = e.supplier_id
    GROUP BY e.supplier_id
    ORDER BY cnt DESC
""").fetchall()
for r in rows:
    print(f"  supplier_id={r['name'] or 'NULL/unmatched'}: {r['cnt']} emails")

print()
print("=== nlp_status distribution ===")
rows = db.execute("""
    SELECT nlp_status, COUNT(*) as cnt FROM emails GROUP BY nlp_status
""").fetchall()
for r in rows:
    print(f"  {r['nlp_status']}: {r['cnt']}")

print()
print("=== sample emails with supplier_id set ===")
rows = db.execute("""
    SELECT e.message_id, e.sender_email, e.supplier_id, s.name, e.nlp_status
    FROM emails e LEFT JOIN suppliers s ON s.id = e.supplier_id
    WHERE e.supplier_id IS NOT NULL
    LIMIT 10
""").fetchall()
for r in rows:
    print(f"  [{r['name']}] {r['sender_email'][:40]} nlp={r['nlp_status']}")

db.close()
