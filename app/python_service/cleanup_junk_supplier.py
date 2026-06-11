import sqlite3

db = sqlite3.connect('data/rfq_flow.db')

# Remove junk supplier (imap.yandex.com - this is your own mail server, not a supplier)
db.execute('UPDATE emails SET supplier_id = NULL WHERE supplier_id = 5')
db.execute('DELETE FROM supplier_contact_emails WHERE supplier_id = 5')
db.execute('DELETE FROM suppliers WHERE id = 5')
db.commit()

print('Cleaned up junk supplier.')
print('Remaining suppliers:')
for row in db.execute('SELECT id, name FROM suppliers').fetchall():
    print(f'  id={row[0]} {row[1]}')

db.close()
