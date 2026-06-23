"""
One-time migration: remap the old 6-step taxonomy (step_assigned 0-5) onto
the new 4-step PR/RFQ/CI/Downpayment structure.

THIS IS NOT A SAFE, AUTO-APPLYING MIGRATION. It rewrites historical
step_assigned values across your whole emails table. Run it exactly ONCE,
after backing up rfq_flow.db, and only after confirming the dry-run summary
looks right.

Old taxonomy (from ai/pipeline.py's classify_step_llm prompt):
  0 = Purchase Request (internal trigger from boss, OR our first ask to supplier)
  1 = RFQ Sent
  2 = RFQ Received
  3 = Negotiation (re: already-quoted items)
  4 = Invoice / PI
  5 = CI Approved

New taxonomy:
  0 = PR          (internal-only, never supplier-facing)
  1 = RFQ         (merges old RFQ Sent + RFQ Received)
  2 = CI          (merges old Negotiation + Invoice + CI Approved)
  3 = Downpayment (new — no old equivalent; populated retroactively below
                    via keyword detection, otherwise only going forward)

Mapping rules:
  old 0, supplier_id IS NULL      -> new 0 (PR)
      Old step 0 explicitly covered two different things (boss-internal
      trigger OR our own first ask to a supplier). supplier_id is only ever
      set via sender/recipient address matching against a known supplier —
      so its absence reliably means this email never touched a supplier at
      all, matching the new PR step's "never supplier-facing" definition.
  old 0, supplier_id IS NOT NULL  -> new 1 (RFQ)
      A supplier was involved somehow, so by the new spec this can't be PR.
  old 1, old 2                    -> new 1 (RFQ)
  old 3, old 4, old 5             -> new 2 (CI), UNLESS subject/body matches
                                      a prepayment keyword (see below), in
                                      which case -> new 3 (Downpayment).

The keyword detection for Downpayment is a zero-cost heuristic (no LLM
calls), consistent with how bootstrap_rules.py already mines patterns
directly from existing data in this codebase. It will miss some genuinely-
downpayment emails phrased differently, and may occasionally over-match —
acceptable for a one-time historical pass; going forward, real classification
(once the NLP prompt is updated) will be far more accurate than this.

Run from python_service/:
    python migrate_step_logic.py            (dry run — reports counts only)
    python migrate_step_logic.py --commit    (actually applies the changes)
"""
import sqlite3
import sys
import re

DB_PATH = 'data/rfq_flow.db'

DOWNPAYMENT_KEYWORDS = [
    # English
    "prepayment", "pre-payment", "down payment", "downpayment",
    "advance payment", "deposit",
    # Russian
    "предоплата", "предоплату", "предоплате",
    "аванс", "авансовый", "авансом",
    # Turkish (lower confidence — included for suppliers like Yumak)
    "ön ödeme", "peşinat",
]

_keyword_pattern = re.compile(
    "|".join(re.escape(k) for k in DOWNPAYMENT_KEYWORDS),
    re.IGNORECASE,
)


def is_downpayment_related(subject: str, body_text: str) -> bool:
    haystack = f"{subject or ''} {(body_text or '')[:2000]}"
    return bool(_keyword_pattern.search(haystack))


def main():
    commit = '--commit' in sys.argv

    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    print("[STEP-MIGRATE] Loading all emails with a step_assigned value...")
    rows = db.execute("""
        SELECT id, subject, body_text, supplier_id, step_assigned
        FROM emails
        WHERE step_assigned IS NOT NULL
    """).fetchall()
    print(f"[STEP-MIGRATE] {len(rows)} emails found\n")

    # Plan every row's new value first (pure computation, no DB writes yet)
    # so the dry-run report and the actual commit are guaranteed consistent.
    plan = []  # list of (id, old_step, new_step, reason)
    counts = {0: 0, 1: 0, 2: 0, 3: 0}

    for row in rows:
        old = row["step_assigned"]

        if old == 0:
            if row["supplier_id"] is None:
                new = 0
                reason = "old PR, no supplier_id -> PR"
            else:
                new = 1
                reason = "old PR, has supplier_id -> RFQ"
        elif old in (1, 2):
            new = 1
            reason = f"old step {old} -> RFQ"
        elif old in (3, 4, 5):
            if is_downpayment_related(row["subject"], row["body_text"]):
                new = 3
                reason = f"old step {old}, prepayment keyword matched -> Downpayment"
            else:
                new = 2
                reason = f"old step {old} -> CI"
        else:
            # Unexpected value outside 0-5 — leave untouched, flag it.
            new = old
            reason = f"UNRECOGNIZED old step {old} — left unchanged, review manually"

        plan.append((row["id"], old, new, reason))
        if new in counts:
            counts[new] += 1

    print("[STEP-MIGRATE] Dry-run summary — resulting distribution under new taxonomy:")
    print(f"  New step 0 (PR):          {counts[0]}")
    print(f"  New step 1 (RFQ):         {counts[1]}")
    print(f"  New step 2 (CI):          {counts[2]}")
    print(f"  New step 3 (Downpayment): {counts[3]}  <- includes retroactive keyword matches")

    unrecognized = [p for p in plan if "UNRECOGNIZED" in p[3]]
    if unrecognized:
        print(f"\n[STEP-MIGRATE] WARNING: {len(unrecognized)} emails had a step_assigned "
              f"value outside 0-5 and were left unchanged. Review these manually:")
        for p in unrecognized[:10]:
            print(f"    email id={p[0]}, step_assigned={p[1]}")

    print(f"\n[STEP-MIGRATE] Sample of Downpayment reclassifications (first 10):")
    downpayment_samples = [p for p in plan if p[2] == 3][:10]
    if not downpayment_samples:
        print("    (none found)")
    for p in downpayment_samples:
        subj = next((r["subject"] for r in rows if r["id"] == p[0]), "")
        print(f"    email id={p[0]}: old step {p[1]} -> Downpayment | subject: {subj[:80]!r}")

    if not commit:
        print("\n[STEP-MIGRATE] DRY RUN ONLY — no changes have been made.")
        print("[STEP-MIGRATE] Review the summary above. If it looks right, BACK UP")
        print("[STEP-MIGRATE] rfq_flow.db, then re-run with --commit to apply.")
        db.close()
        return

    print("\n[STEP-MIGRATE] --commit flag detected.")
    confirm = input(
        "Type EXACTLY 'yes, remap step_assigned' to apply these changes "
        "(anything else cancels): "
    )
    if confirm.strip() != "yes, remap step_assigned":
        print("[STEP-MIGRATE] Confirmation text did not match — aborted, no changes made.")
        db.close()
        return

    print("[STEP-MIGRATE] Applying...")
    for email_id, old, new, reason in plan:
        if new != old:
            db.execute("UPDATE emails SET step_assigned = ? WHERE id = ?", (new, email_id))
    db.commit()
    db.close()
    print(f"[STEP-MIGRATE] Done. {sum(1 for p in plan if p[1] != p[2])} rows updated.")


if __name__ == '__main__':
    main()
