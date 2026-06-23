"""
Backfill the `parts` table from already-completed emails' nlp_result JSON.

Pure data population — this does NOT trigger any thread-merge logic. It only
exists to give the part-number matching index (used by
reconcile_thread_by_part_numbers in database.py) historical coverage from
day one, so NEW emails arriving after this runs can match against your
existing ~2,900 already-processed emails, not just future ones.

Deliberately does NOT retroactively merge already-fragmented threads (e.g.
the Yumak case — ПРОФОРМА / YUMAK / HAZIR OLAN ÜRÜNLER currently sitting as
three separate threads). That cleanup is a separate, explicitly deferred
task for once full RFQ-assignment logic is in place — this script only
back-fills data, it never calls UPDATE on emails.thread_id or threads.

Run from python_service/:
    python backfill_parts.py
"""
import sqlite3
import json

DB_PATH = 'data/rfq_flow.db'


def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    print("[BACKFILL-PARTS] Loading completed/manual emails with nlp_result...")
    rows = db.execute("""
        SELECT id, message_id, supplier_id, thread_id, sent_at, nlp_result
        FROM emails
        WHERE nlp_status IN ('completed', 'manual')
          AND nlp_result IS NOT NULL
          AND supplier_id IS NOT NULL
          AND thread_id IS NOT NULL
    """).fetchall()

    print(f"[BACKFILL-PARTS] {len(rows)} eligible emails found")

    # Avoid inserting duplicates if this script is run more than once —
    # key on (message_id, part_number), since that combination is unique
    # per real extraction (one email can have multiple distinct parts).
    existing = db.execute("""
        SELECT message_id, part_number FROM parts
        WHERE message_id IS NOT NULL
    """).fetchall()
    already_have = set((r["message_id"], r["part_number"]) for r in existing)

    inserted = 0
    skipped_no_parts = 0
    skipped_duplicate = 0
    skipped_bad_json = 0

    for row in rows:
        try:
            result = json.loads(row["nlp_result"])
        except (json.JSONDecodeError, TypeError):
            skipped_bad_json += 1
            continue

        part_numbers = result.get("part_numbers") or []
        if not part_numbers:
            skipped_no_parts += 1
            continue

        for p in part_numbers:
            # Historical nlp_result data isn't uniform — some older extractions
            # (BASE heuristic mode, or earlier pipeline versions) stored
            # part_numbers as a list of bare strings, not {"part_number": ...}
            # dicts. Normalize both shapes rather than assuming one.
            if isinstance(p, dict):
                part_number = str(p.get("part_number") or "").strip()
                description = p.get("description")
                quantity = p.get("quantity")
                unit_price = p.get("unit_price")
                currency = p.get("currency")
            elif isinstance(p, str):
                part_number = p.strip()
                description = None
                quantity = None
                unit_price = None
                currency = None
            else:
                continue

            if not part_number:
                continue

            key = (row["message_id"], part_number)
            if key in already_have:
                skipped_duplicate += 1
                continue

            db.execute("""
                INSERT INTO parts (supplier_id, thread_id, message_id, part_number,
                                    description, quantity, price, currency, email_sent_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                row["supplier_id"], str(row["thread_id"]), row["message_id"], part_number,
                description, quantity, unit_price,
                currency, row["sent_at"],
            ))
            already_have.add(key)
            inserted += 1

    db.commit()

    print(f"\n[BACKFILL-PARTS] Inserted {inserted} part rows")
    print(f"[BACKFILL-PARTS] Skipped: {skipped_no_parts} (no part_numbers extracted), "
          f"{skipped_duplicate} (already backfilled), {skipped_bad_json} (bad JSON)")

    total_parts = db.execute("SELECT COUNT(*) FROM parts").fetchone()[0]
    distinct_part_numbers = db.execute("SELECT COUNT(DISTINCT part_number) FROM parts").fetchone()[0]
    print(f"[BACKFILL-PARTS] parts table now has {total_parts} rows, "
          f"{distinct_part_numbers} distinct part numbers")

    db.close()
    print("\n[DONE] — no merges were performed. New emails processed from now on will\n"
          "        match against this historical data via reconcile_thread_by_part_numbers().")


if __name__ == '__main__':
    main()
