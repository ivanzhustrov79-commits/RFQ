import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.execute("DELETE FROM learned_rules")
db.execute("DELETE FROM rule_corrections")
db.commit()
print("Cleared learned_rules and rule_corrections tables")
db.close()
