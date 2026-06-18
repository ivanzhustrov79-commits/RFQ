"""
Bootstrap learned_rules from existing high-confidence qwen classifications.
Zero API cost — mines patterns already present in DB.

Run from python_service/:
python bootstrap_rules.py
"""
import sqlite3
import json
import re
from collections import defaultdict

DB_PATH = 'data/rfq_flow.db'
MIN_CONFIDENCE = 0.85   # only trust qwen's own high-confidence calls

STOPWORDS = set("""
the and for with from this that have been will are was were what when where
для что как это вам нас они она его её мне был была было they were
january february march april may june july august september october november december
январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь
января февраля марта апреля мая июня июля августа сентября октября ноября декабря
holiday holidays festival christmas newyear merry happy day days notice
additional important verification dimensions quality check checking
""".split())

MIN_KEYWORD_LEN = 4
MIN_OCCURRENCES = 4      # raised from 3 — require stronger signal
MIN_AGREEMENT = 0.85     # raised from 0.8 — stricter consistency requirement


def is_numeric_like(word: str) -> bool:
    """Reject pure numbers, dates, reference codes like '251208' — not semantic keywords."""
    digit_ratio = sum(c.isdigit() for c in word) / len(word)
    return digit_ratio > 0.5


def extract_keywords(text: str) -> set:
    words = re.findall(r'[a-zа-я0-9]{%d,}' % MIN_KEYWORD_LEN, text.lower())
    return set(w for w in words if w not in STOPWORDS)


def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    print("[BOOTSTRAP] Loading high-confidence classified emails...")
    rows = db.execute("""
        SELECT message_id, subject, step_assigned, supplier_id, nlp_result,
               is_significant, significance_confidence
        FROM emails
        WHERE nlp_status IN ('completed', 'manual')
          AND nlp_result IS NOT NULL
    """).fetchall()

    print(f"[BOOTSTRAP] {len(rows)} classified emails found")

    # Group keyword -> step -> [message_ids]  (universal, ignoring supplier for now)
    pattern_votes = defaultdict(lambda: defaultdict(list))
    # Same idea but for significance: keyword -> is_significant (0/1) -> [message_ids]
    significance_votes = defaultdict(lambda: defaultdict(list))

    kept = 0
    sig_kept = 0
    for row in rows:
        try:
            nlp = json.loads(row["nlp_result"])
        except (json.JSONDecodeError, TypeError):
            continue

        confidence = nlp.get("confidence", 0)
        keywords = extract_keywords(row["subject"] or "")
        keywords = set(k for k in keywords if not is_numeric_like(k))

        step = row["step_assigned"]
        if step is not None and confidence >= MIN_CONFIDENCE and keywords:
            kept += 1
            for kw in keywords:
                pattern_votes[kw][step].append(row["message_id"])

        # Significance bootstrapping uses its own confidence field, separate from step
        # confidence — they're different judgments and shouldn't share a threshold check.
        sig_confidence = row["significance_confidence"]
        is_sig = row["is_significant"]
        if sig_confidence is not None and sig_confidence >= MIN_CONFIDENCE and is_sig is not None and keywords:
            sig_kept += 1
            for kw in keywords:
                significance_votes[kw][int(is_sig)].append(row["message_id"])

    print(f"[BOOTSTRAP] {kept} emails passed step confidence >= {MIN_CONFIDENCE}")
    print(f"[BOOTSTRAP] {sig_kept} emails passed significance confidence >= {MIN_CONFIDENCE}")

    # For each keyword, find the dominant step (if it repeats enough and is consistent)
    seeded = 0
    skipped_inconsistent = 0

    for keyword, step_votes in pattern_votes.items():
        total_votes = sum(len(v) for v in step_votes.values())
        if total_votes < MIN_OCCURRENCES:
            continue

        # Find dominant step
        best_step = max(step_votes.items(), key=lambda kv: len(kv[1]))
        best_step_num, best_examples = best_step
        agreement_ratio = len(best_examples) / total_votes

        # Require strong agreement to avoid seeding noisy/ambiguous keywords
        if agreement_ratio < MIN_AGREEMENT:
            skipped_inconsistent += 1
            continue

        times_confirmed = len(best_examples)
        confidence = times_confirmed / (times_confirmed + 1)  # same formula as rule_engine

        # Check if rule already exists for this keyword pattern (compare via parsed JSON,
        # not raw string LIKE, since Cyrillic/Unicode escaping can differ between writes)
        existing_rows = db.execute("""
            SELECT id, condition_keywords FROM learned_rules
            WHERE rule_type='step_classification' AND action = ?
        """, (f"step={best_step_num}",)).fetchall()

        existing = None
        for row in existing_rows:
            try:
                stored_keywords = json.loads(row["condition_keywords"] or "[]")
            except (json.JSONDecodeError, TypeError):
                continue
            if keyword in stored_keywords:
                existing = row
                break

        if existing:
            continue

        status = 'active' if (times_confirmed >= 3 and confidence >= 0.7) else 'candidate'

        db.execute("""
            INSERT INTO learned_rules (
                rule_type, supplier_id, condition_pattern, condition_keywords,
                action, confidence, times_confirmed, status, source_examples
            ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "step_classification",
            f"subject contains '{keyword}'",
            json.dumps([keyword], ensure_ascii=False),
            f"step={best_step_num}",
            confidence,
            times_confirmed,
            status,
            json.dumps(best_examples[:10], ensure_ascii=False),  # cap stored examples
        ))
        seeded += 1

    db.commit()

    print(f"\n[BOOTSTRAP] Seeded {seeded} step_classification rules ({skipped_inconsistent} skipped for inconsistency)")

    # --- Significance bootstrapping: same algorithm, different rule_type and vote dict ---
    sig_seeded = 0
    sig_skipped = 0

    for keyword, sig_votes in significance_votes.items():
        total_votes = sum(len(v) for v in sig_votes.values())
        if total_votes < MIN_OCCURRENCES:
            continue

        best_sig = max(sig_votes.items(), key=lambda kv: len(kv[1]))
        best_sig_value, best_examples = best_sig
        agreement_ratio = len(best_examples) / total_votes

        if agreement_ratio < MIN_AGREEMENT:
            sig_skipped += 1
            continue

        times_confirmed = len(best_examples)
        confidence = times_confirmed / (times_confirmed + 1)

        existing_rows = db.execute("""
            SELECT id, condition_keywords FROM learned_rules
            WHERE rule_type='significance' AND action = ?
        """, (f"is_significant={bool(best_sig_value)}",)).fetchall()

        existing = None
        for row in existing_rows:
            try:
                stored_keywords = json.loads(row["condition_keywords"] or "[]")
            except (json.JSONDecodeError, TypeError):
                continue
            if keyword in stored_keywords:
                existing = row
                break

        if existing:
            continue

        status = 'active' if (times_confirmed >= 3 and confidence >= 0.7) else 'candidate'

        db.execute("""
            INSERT INTO learned_rules (
                rule_type, supplier_id, condition_pattern, condition_keywords,
                action, confidence, times_confirmed, status, source_examples
            ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "significance",
            f"subject contains '{keyword}'",
            json.dumps([keyword], ensure_ascii=False),
            f"is_significant={bool(best_sig_value)}",
            confidence,
            times_confirmed,
            status,
            json.dumps(best_examples[:10], ensure_ascii=False),
        ))
        sig_seeded += 1

    db.commit()
    print(f"[BOOTSTRAP] Seeded {sig_seeded} significance rules ({sig_skipped} skipped for inconsistency)")

    # Show summary
    active = db.execute("SELECT COUNT(*) FROM learned_rules WHERE status='active'").fetchone()[0]
    candidate = db.execute("SELECT COUNT(*) FROM learned_rules WHERE status='candidate'").fetchone()[0]
    print(f"[BOOTSTRAP] Rules now: {active} active, {candidate} candidate (across all rule_types)")

    print("\nTop seeded rules (any type):")
    top = db.execute("""
        SELECT rule_type, condition_pattern, action, confidence, times_confirmed, status
        FROM learned_rules ORDER BY times_confirmed DESC LIMIT 15
    """).fetchall()
    for r in top:
        print(f"  [{r['status']}] ({r['rule_type']}) {r['condition_pattern']} -> {r['action']} "
              f"(confirmed={r['times_confirmed']}, conf={r['confidence']:.2f})")

    db.close()
    print("\n[DONE]")


if __name__ == '__main__':
    main()
