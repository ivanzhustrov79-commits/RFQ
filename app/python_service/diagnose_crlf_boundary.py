import sqlite3
db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row

row = db.execute("SELECT body_text FROM emails WHERE id = 1218").fetchone()
text = row["body_text"]

idx = text.find("--=-Bw3Wkk")
if idx >= 0:
    snippet = text[max(0, idx-20):idx+80]
    print("Snippet around boundary marker:")
    print(repr(snippet))
    print()
    print("Character-by-character around the transition (boundary -> Content-Type):")
    transition_idx = text.find("MQA=Content-Type")
    if transition_idx >= 0:
        for i in range(max(0, transition_idx-5), min(len(text), transition_idx+20)):
            print(f"  [{i}] {text[i]!r} (ord={ord(text[i])})")
else:
    print("Boundary string not found in stored body_text at all")

db.close()
