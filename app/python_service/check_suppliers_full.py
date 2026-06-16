import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

print("=== All suppliers ===")
for r in db.execute("SELECT id, name, folder_name_normalized FROM suppliers ORDER BY id").fetchall():
    print(f"  id={r['id']} name={r['name']} folder={r['folder_name_normalized']}")

print("\n=== All contact patterns ===")
for r in db.execute("SELECT s.name, c.email_pattern, c.match_type FROM supplier_contact_emails c JOIN suppliers s ON s.id=c.supplier_id ORDER BY s.name").fetchall():
    print(f"  {r['name']}: {r['email_pattern']} ({r['match_type']})")

db.close()
