"""
Comprehensive health check for email body_text quality. Detects several KNOWN
mis-parsing signatures we've found so far, plus general anomaly heuristics for
catching new/unknown cases. This is NOT exhaustive — email MIME parsing has decades
of client-specific quirks, and new failure modes will likely surface over time as
more mail gets reviewed. Re-run this periodically (e.g. after each major sync) rather
than treating it as a one-time fix.

Run from python_service/:
python health_check_body_text.py
"""
import sqlite3
import re
from collections import Counter

db = sqlite3.connect('data/rfq_flow.db')
db.row_factory = sqlite3.Row


# --- Known signature detectors -------------------------------------------------

def is_base64_attachment_leak(text):
    """Detects raw base64-encoded file content leaking into body text — catches
    PDFs (JVBERi0 = '%PDF' in base64), images (common JPEG/PNG headers), Office
    docs (PK = zip-based formats), and generic long base64-looking blocks."""
    if not text:
        return False, None
    sample = text.strip()[:200]
    known_b64_signatures = {
        'JVBERi0': 'PDF',
        '/9j/': 'JPEG',
        'iVBORw0KGgo': 'PNG',
        'UEsDB': 'Office/ZIP (docx/xlsx/pptx)',
        'R0lGOD': 'GIF',
    }
    for sig, filetype in known_b64_signatures.items():
        if sig in sample:
            return True, f"base64 {filetype} leak"
    long_b64_run = re.search(r'[A-Za-z0-9+/]{100,}={0,2}', text)
    if long_b64_run:
        return True, "long unbroken base64-looking run"
    return False, None


def is_truncated_base64_garbage(text):
    """Detects the base64-truncated-then-decoded garbage pattern (binary noise with
    high control-character density) — the bug fixed earlier today (pre-fix data)."""
    if not text or len(text) < 10:
        return False, None
    suspicious = 0
    for ch in text:
        code = ord(ch)
        if code < 32 and ch not in '\n\r\t':
            suspicious += 1
        elif code == 0xFFFD:
            suspicious += 1
        elif 0x80 <= code <= 0x9F:
            suspicious += 1
    ratio = suspicious / len(text)
    if ratio > 0.05:
        return True, f"control-char ratio {ratio:.2f}"
    return False, None


def is_low_printable_ratio(text):
    """General catch-all: very low printable-character ratio suggests SOME kind of
    encoding/decoding failure, even if we don't know the specific cause."""
    if not text:
        return False, None
    readable = sum(1 for ch in text if ch.isprintable() or ch in '\n\r\t')
    ratio = readable / len(text)
    if ratio < 0.70:
        return True, f"printable ratio {ratio:.2f}"
    return False, None


def has_mime_header_leak(text):
    """Detects MIME headers (Content-Type, Content-Transfer-Encoding) appearing IN
    the stored body text — means header/body separation failed. Deliberately does
    NOT try to pattern-match boundary marker LINES (e.g. '--xyz123') via regex —
    two attempts at that produced false positives on legitimate email signatures,
    which commonly use dashes and contain digits (phone numbers, etc). The literal
    header text checks below are unambiguous and can't false-positive on prose."""
    if not text:
        return False, None
    if re.search(r'Content-Type:\s*\S+/\S+', text):
        return True, "Content-Type header found in body"
    if re.search(r'Content-Transfer-Encoding:\s*(base64|quoted-printable|7bit|8bit)', text, re.IGNORECASE):
        return True, "Content-Transfer-Encoding header found in body"
    return False, None


def has_mojibake_signature(text):
    """Detects classic mojibake patterns from Cyrillic-as-Latin1 misdecoding —
    specific character sequences that almost never appear in legitimate text but
    are extremely common artifacts of this specific encoding bug."""
    if not text:
        return False, None
    mojibake_markers = ['Ð\x90', 'Ð\x9f', 'Ñ\x80Ð', 'óÅ', 'ÐÅ', 'þÉ', 'âÒÁ']
    hits = sum(1 for m in mojibake_markers if m in text)
    if hits >= 1:
        return True, f"{hits} mojibake marker(s) found"
    return False, None


# --- Run all checks --------------------------------------------------------------

CHECKS = [
    ("base64_attachment_leak", is_base64_attachment_leak),
    ("truncated_base64_garbage", is_truncated_base64_garbage),
    ("low_printable_ratio", is_low_printable_ratio),
    ("mime_header_leak", has_mime_header_leak),
    ("mojibake_signature", has_mojibake_signature),
]

rows = db.execute("""
    SELECT id, message_id, subject, sender_email, body_text, supplier_id, step_assigned, nlp_status
    FROM emails WHERE body_text IS NOT NULL AND body_text != ''
""").fetchall()

print(f"=== Health-checking {len(rows)} emails across {len(CHECKS)} known signatures ===\n")

issues_by_type = Counter()
flagged_ids = set()
details = []

for r in rows:
    body = r["body_text"]
    email_issues = []
    for check_name, check_fn in CHECKS:
        matched, reason = check_fn(body)
        if matched:
            email_issues.append((check_name, reason))
            issues_by_type[check_name] += 1

    if email_issues:
        flagged_ids.add(r["id"])
        details.append({
            "id": r["id"], "subject": r["subject"], "sender_email": r["sender_email"],
            "supplier_id": r["supplier_id"], "nlp_status": r["nlp_status"],
            "issues": email_issues, "body_sample": body[:80],
        })

print(f"=== {len(flagged_ids)} emails flagged with at least one issue ===\n")
print("Breakdown by issue type:")
for issue_type, count in issues_by_type.most_common():
    print(f"  {issue_type}: {count}")

print(f"\n=== Detail (first 30) ===\n")
for d in details[:30]:
    issue_summary = ", ".join(f"{name}({reason})" for name, reason in d["issues"])
    print(f"  id={d['id']} supplier_id={d['supplier_id']} nlp_status={d['nlp_status']}")
    print(f"    subject: {d['subject']!r}")
    print(f"    issues: {issue_summary}")
    print(f"    sample: {d['body_sample']!r}\n")

if len(details) > 30:
    print(f"  ... and {len(details) - 30} more")

print(f"\n=== Summary ===")
print(f"  Total checked: {len(rows)}")
print(f"  Flagged: {len(flagged_ids)} ({len(flagged_ids)/len(rows)*100:.1f}%)")
already_classified = sum(1 for d in details if d["nlp_status"] in ("completed", "manual"))
print(f"  Already classified (potentially on bad data): {already_classified}")

with open('flagged_body_issues.txt', 'w') as f:
    for fid in sorted(flagged_ids):
        f.write(f"{fid}\n")
print(f"\n  Flagged IDs written to flagged_body_issues.txt for follow-up reset")

db.close()
