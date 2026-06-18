import sqlite3
import re

db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row


def garbled_score(text):
    """Returns ratio of 'suspicious' characters (control chars, high-bit garbage,
    or replacement characters) to total length. High ratio = likely garbled/binary."""
    if not text or len(text) < 10:
        return 0.0
    # Count characters that are control chars (excluding common whitespace),
    # or in suspicious Unicode ranges often seen from misdecoded binary data
    suspicious = 0
    for ch in text:
        code = ord(ch)
        if code < 32 and ch not in '\n\r\t':
            suspicious += 1
        elif 0xFFFD == code:  # replacement character
            suspicious += 1
        elif 0x80 <= code <= 0x9F:  # C1 control range, common in misdecoded latin1/cp1252
            suspicious += 1
    return suspicious / len(text)


def printable_ratio(text):
    """Ratio of normal printable/readable characters (letters in any script, digits,
    common punctuation, whitespace) — low ratio suggests garbled binary."""
    if not text:
        return 1.0
    readable = sum(1 for ch in text if ch.isprintable() or ch in '\n\r\t')
    return readable / len(text)


print("=== Scanning emails table for garbled body_text ===\n")

rows = db.execute("SELECT id, message_id, subject, sender_email, body_text, supplier_id, step_assigned FROM emails WHERE body_text IS NOT NULL AND body_text != ''").fetchall()
print(f"Total emails with body_text: {len(rows)}\n")

garbled = []
for r in rows:
    body = r["body_text"]
    g_score = garbled_score(body)
    p_ratio = printable_ratio(body)
    # Flag as garbled if suspicious chars >5% OR printable ratio <70%
    if g_score > 0.05 or p_ratio < 0.70:
        garbled.append({
            "id": r["id"], "message_id": r["message_id"], "subject": r["subject"],
            "sender_email": r["sender_email"], "supplier_id": r["supplier_id"],
            "step_assigned": r["step_assigned"],
            "garbled_score": round(g_score, 3), "printable_ratio": round(p_ratio, 3),
            "body_len": len(body), "body_sample": body[:80],
        })

print(f"=== {len(garbled)} emails flagged as likely garbled ===\n")
for g in garbled[:40]:
    print(f"  id={g['id']} supplier_id={g['supplier_id']} step={g['step_assigned']} "
          f"score={g['garbled_score']} printable={g['printable_ratio']} len={g['body_len']}")
    print(f"    subject: {g['subject']!r}")
    print(f"    sender: {g['sender_email']!r}")
    print(f"    sample: {g['body_sample']!r}\n")

if len(garbled) > 40:
    print(f"... and {len(garbled) - 40} more")

print(f"\n=== Summary ===")
print(f"  Total emails checked: {len(rows)}")
print(f"  Garbled: {len(garbled)} ({len(garbled)/len(rows)*100:.1f}%)")

# Breakdown by supplier
from collections import Counter
supplier_counts = Counter(g["supplier_id"] for g in garbled)
print(f"\n  By supplier_id: {dict(supplier_counts)}")

# How many of the garbled ones were already NLP-classified (i.e. qwen saw the garbage)?
classified_garbled = [g for g in garbled if g["step_assigned"] is not None]
print(f"  Already classified by qwen (potentially on garbage input): {len(classified_garbled)}")

db.close()
