"""
Backfill supplier_id for already-synced emails where sender-address matching
against supplier_contact_emails never ran (or ran before that supplier's
contact pattern existed yet).

Surfaced by: running migrate_step_logic.py's dry run and finding clearly
supplier-facing emails (Parker, Michelin, ECS, etc.) sitting with
supplier_id IS NULL — meaning they'd incorrectly migrate into the new PR
step, which is defined as "never supplier-facing."

SCOPE LIMITATION (real, not glossed over): this can only fix INBOUND emails
(sender_email IS the supplier) — emails.sender_email is the only address we
have stored. Outbound emails YOU sent TO a supplier, where supplier_id
failed to resolve, can't be recovered this way; that would need the
recipient address, which isn't stored in the DB (only in the original mbox
files). This backfill targets the dominant case shown in the sample data,
not every possible gap.

Run from python_service/:
    python backfill_supplier_ids.py            (dry run — reports only)
    python backfill_supplier_ids.py --commit    (actually applies the fix)
"""
import sqlite3
import sys
import re

DB_PATH = 'data/rfq_flow.db'

ADDR_RE = re.compile(r'[\w.+-]+@[\w.-]+\.\w+')


def resolve_supplier_id(db, sender_email: str):
    """Mirrors database.py's get_supplier_id_by_sender — address match first,
    then domain match — kept as a local copy since this is a standalone
    script (no access to the async aiosqlite connection the live app uses)."""
    m = ADDR_RE.search(sender_email or "")
    if not m:
        return None
    addr = m.group(0).lower()
    domain = "@" + addr.split("@")[-1]

    row = db.execute(
        "SELECT supplier_id FROM supplier_contact_emails WHERE email_pattern = ? AND match_type = 'address'",
        (addr,)
    ).fetchone()
    if row:
        return row["supplier_id"]

    row = db.execute(
        "SELECT supplier_id FROM supplier_contact_emails WHERE email_pattern = ? AND match_type = 'domain'",
        (domain,)
    ).fetchone()
    return row["supplier_id"] if row else None


def main():
    commit = '--commit' in sys.argv

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    print("[BACKFILL-SUPPLIER] Loading emails with supplier_id IS NULL...")
    rows = db.execute("""
        SELECT id, sender_email, subject FROM emails WHERE supplier_id IS NULL
    """).fetchall()
    print(f"[BACKFILL-SUPPLIER] {len(rows)} emails currently have no supplier_id\n")

    plan = []  # (email_id, sender_email, resolved_supplier_id, subject)
    for row in rows:
        resolved = resolve_supplier_id(db, row["sender_email"])
        if resolved:
            plan.append((row["id"], row["sender_email"], resolved, row["subject"]))

    print(f"[BACKFILL-SUPPLIER] {len(plan)} of those CAN be resolved via existing "
          f"supplier_contact_emails sender-address matching\n")

    if plan:
        print("[BACKFILL-SUPPLIER] Sample of resolutions (first 15):")
        for email_id, sender, supplier_id, subject in plan[:15]:
            print(f"    email id={email_id}, supplier_id={supplier_id} | "
                  f"from: {sender[:50]!r} | subject: {(subject or '')[:60]!r}")

    unresolved_count = len(rows) - len(plan)
    print(f"\n[BACKFILL-SUPPLIER] {unresolved_count} emails remain unresolved — either "
          f"genuinely internal (no supplier match expected), or outbound emails this "
          f"script can't recover (see SCOPE LIMITATION in the docstring above).")

    if not commit:
        print("\n[BACKFILL-SUPPLIER] DRY RUN ONLY — no changes have been made.")
        print("[BACKFILL-SUPPLIER] Review the sample above. If it looks right, re-run")
        print("[BACKFILL-SUPPLIER] with --commit to apply, THEN re-run migrate_step_logic.py's")
        print("[BACKFILL-SUPPLIER] dry run again to see the corrected PR/RFQ distribution.")
        db.close()
        return

    print("\n[BACKFILL-SUPPLIER] --commit flag detected.")
    confirm = input(
        "Type EXACTLY 'yes, backfill supplier_id' to apply these changes "
        "(anything else cancels): "
    )
    if confirm.strip() != "yes, backfill supplier_id":
        print("[BACKFILL-SUPPLIER] Confirmation text did not match — aborted, no changes made.")
        db.close()
        return

    print("[BACKFILL-SUPPLIER] Applying...")
    for email_id, sender, supplier_id, subject in plan:
        db.execute("UPDATE emails SET supplier_id = ? WHERE id = ?", (supplier_id, email_id))
    db.commit()
    db.close()
    print(f"[BACKFILL-SUPPLIER] Done. {len(plan)} rows updated.")


if __name__ == '__main__':
    main()
