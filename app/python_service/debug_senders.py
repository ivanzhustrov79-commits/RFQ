import sqlite3

db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

print("=== trusted_senders ===")
for r in db.execute("SELECT * FROM trusted_senders").fetchall():
    print(f"  {r['sender_type']}: {r['email']}")

print("\n=== supplier_contact_emails (sample) ===")
for r in db.execute("SELECT * FROM supplier_contact_emails LIMIT 10").fetchall():
    print(f"  supplier_id={r['supplier_id']} pattern={r['email_pattern']} type={r['match_type']}")

print("\n=== sample sender_email values in emails ===")
for r in db.execute("SELECT DISTINCT sender_email FROM emails WHERE supplier_id IS NOT NULL LIMIT 10").fetchall():
    print(f"  {r['sender_email']}")

print("\n=== self email check ===")
for email in ['izhustrov@import-detal36.ru', 'izhustrov@europa-parts.kz', 'commercial@field-pro.ae']:
    count = db.execute("SELECT COUNT(*) FROM emails WHERE LOWER(sender_email)=?", (email.lower(),)).fetchone()[0]
    print(f"  {email}: {count} emails as sender")

db.close()
