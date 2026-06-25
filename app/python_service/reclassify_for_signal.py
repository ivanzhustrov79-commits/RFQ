"""
Scoped reclassification: re-queues ALREADY-COMPLETED tracked-supplier/Boss
emails that predate the signal_type system, so they get a second pass
through the (now signal-aware) classifier.

WHY THIS EXISTS: queue_emails_for_nlp deliberately skips anything already
'completed' (that's the safety check protecting against accidental mass
re-processing). Your tracked suppliers' historical emails are already
'completed' from before signal_type existed — so signal_type sits NULL on
them forever unless something explicitly resets their status. The toggle-
triggered resync (syncSpecificSupplier) can't fix this either, for the
exact same reason: it relies on that same safety check.

SCOPE (deliberately narrow, per your explicit ask — only chosen suppliers,
not the ~2,047 untracked-sender emails sitting in the DB as inert noise):
    nlp_status = 'completed' AND signal_type IS NULL
    AND (supplier_id IS NOT NULL OR sender_email matches a Boss address)

Explicitly EXCLUDED:
  - nlp_status = 'manual' rows — never touched, your overrides are protected
  - anything already classified under the NEW system (signal_type NOT NULL)
  - untracked-sender noise (supplier_id IS NULL and not Boss)

COST, stated plainly: this does NOT skip the LLM call — it puts these
emails back in the normal queue, so qwen processes them at its usual
CPU-bound pace. At the roughly 1-2 emails/minute worst-case rate seen
earlier this session, a few hundred emails could take HOURS, not minutes.
This is a deliberate, one-time investment to get accurate colors on your
real suppliers' history — not something to run casually or repeatedly.

Run from python_service/:
    python reclassify_for_signal.py            (dry run — reports only)
    python reclassify_for_signal.py --commit    (actually queues them)
"""
import sqlite3
import sys

DB_PATH = 'data/rfq_flow.db'

BOSS_ADDRESSES = ['info@field-pro.ae', 'vlebedinets@agro-pro2014.ru']


def main():
    commit = '--commit' in sys.argv

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    boss_conditions = " OR ".join(["sender_email LIKE ?" for _ in BOSS_ADDRESSES])
    boss_params = [f"%{addr}%" for addr in BOSS_ADDRESSES]

    print("[RECLASSIFY] Finding completed, pre-signal_type emails for tracked suppliers + Boss...")
    rows = db.execute(f"""
        SELECT id, message_id, supplier_id, sender_email, subject
        FROM emails
        WHERE nlp_status = 'completed'
          AND signal_type IS NULL
          AND (supplier_id IS NOT NULL OR {boss_conditions})
    """, boss_params).fetchall()

    print(f"[RECLASSIFY] {len(rows)} emails eligible for reclassification\n")

    if not rows:
        print("[RECLASSIFY] Nothing to do — either already reclassified, or no tracked-supplier/Boss")
        print("[RECLASSIFY] emails are missing signal_type.")
        db.close()
        return

    by_supplier = {}
    boss_count = 0
    for r in rows:
        if r["supplier_id"] is not None:
            by_supplier[r["supplier_id"]] = by_supplier.get(r["supplier_id"], 0) + 1
        else:
            boss_count += 1

    print("[RECLASSIFY] Breakdown by supplier_id:")
    for sid, count in sorted(by_supplier.items(), key=lambda kv: -kv[1]):
        print(f"    supplier_id={sid}: {count} emails")
    if boss_count:
        print(f"    Boss correspondence (no supplier_id): {boss_count} emails")

    print(f"\n[RECLASSIFY] Sample (first 10):")
    for r in rows[:10]:
        print(f"    id={r['id']} supplier_id={r['supplier_id']} | {r['sender_email'][:40]!r} | {(r['subject'] or '')[:60]!r}")

    if not commit:
        print(f"\n[RECLASSIFY] DRY RUN ONLY — no changes made.")
        print(f"[RECLASSIFY] This will queue {len(rows)} emails for a REAL qwen pass — at the")
        print(f"[RECLASSIFY] observed worst-case rate (~1-2/min under CPU load), that could take")
        print(f"[RECLASSIFY] several hours. Re-run with --commit when you're ready for that.")
        db.close()
        return

    print(f"\n[RECLASSIFY] --commit flag detected.")
    confirm = input(
        f"Type EXACTLY 'yes, requeue {len(rows)} emails' to proceed (anything else cancels): "
    )
    if confirm.strip() != f"yes, requeue {len(rows)} emails":
        print("[RECLASSIFY] Confirmation text did not match — aborted, no changes made.")
        db.close()
        return

    ids = [r["id"] for r in rows]
    placeholders = ",".join("?" * len(ids))
    db.execute(f"""
        UPDATE emails SET nlp_status = 'pending'
        WHERE id IN ({placeholders})
    """, ids)
    db.commit()
    db.close()
    print(f"[RECLASSIFY] Done. {len(rows)} emails re-queued — the background NLP worker")
    print(f"[RECLASSIFY] will pick them up at its normal pace. No need to restart anything.")


if __name__ == '__main__':
    main()
