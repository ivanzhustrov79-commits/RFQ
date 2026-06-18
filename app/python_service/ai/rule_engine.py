"""
Rule Engine - Teacher/Student learning loop between BOOST API and local qwen2.5:3b
Place in python_service/ai/rule_engine.py

Lifecycle:
  candidate (new, low trust) -> active (proven, used in prompts) -> retired (contradicted too much)

Promotion: candidate -> active requires times_confirmed >= MIN_CONFIRMATIONS AND confidence >= ACTIVE_THRESHOLD
Demotion: active -> retired when confidence drops below RETIRE_THRESHOLD
"""
import json
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

MIN_CONFIRMATIONS = 3       # candidate needs this many confirmations before becoming active
ACTIVE_THRESHOLD = 0.7      # confidence needed to promote candidate -> active
RETIRE_THRESHOLD = 0.3      # confidence below this retires an active rule


def compute_confidence(times_confirmed: int, times_contradicted: int) -> float:
    """Simple Bayesian-ish confidence: more confirmations = higher trust, contradictions hurt."""
    return times_confirmed / (times_confirmed + times_contradicted + 1)


async def find_matching_rule(db, condition_keywords: List[str], rule_type: str,
                               supplier_id: Optional[int] = None) -> Optional[Dict]:
    """
    Find an existing rule whose condition_keywords overlap significantly with the given keywords.
    Returns the best matching rule dict, or None.
    """
    rows = await db.execute("""
        SELECT * FROM learned_rules
        WHERE rule_type = ? AND status != 'retired'
          AND (supplier_id = ? OR supplier_id IS NULL)
        ORDER BY confidence DESC
    """, (rule_type, supplier_id))
    candidates = await rows.fetchall()

    keyword_set = set(k.lower() for k in condition_keywords)
    best_match = None
    best_overlap = 0

    for rule in candidates:
        try:
            rule_keywords = set(json.loads(rule["condition_keywords"] or "[]"))
        except (json.JSONDecodeError, TypeError):
            continue
        overlap = len(keyword_set & rule_keywords)
        if overlap > best_overlap and overlap >= 2:  # require at least 2 shared keywords
            best_overlap = overlap
            best_match = dict(rule)

    return best_match


async def record_correction(db, message_id: str, rule_type: str, action: str,
                              condition_keywords: List[str], supplier_id: Optional[int],
                              old_value: Optional[str], new_value: str,
                              source: str = "boost_api", reason: str = ""):
    """
    Record a correction event. Either reinforces an existing rule or creates a new candidate.
    This is the core learning step — called whenever BOOST API or user correction provides
    a classification that differs from (or confirms) what was previously assigned.
    """
    existing = await find_matching_rule(db, condition_keywords, rule_type, supplier_id)

    if existing:
        # Does this correction CONFIRM or CONTRADICT the existing rule?
        if existing["action"] == action:
            # Confirmed — reinforce
            new_confirmed = existing["times_confirmed"] + 1
            new_confidence = compute_confidence(new_confirmed, existing["times_contradicted"])
            new_status = existing["status"]
            if new_status == "candidate" and new_confirmed >= MIN_CONFIRMATIONS and new_confidence >= ACTIVE_THRESHOLD:
                new_status = "active"
                logger.info("[RULES] Promoted rule #%d to ACTIVE (confirmed=%d, confidence=%.2f)",
                            existing["id"], new_confirmed, new_confidence)

            examples = json.loads(existing["source_examples"] or "[]")
            if message_id not in examples:
                examples.append(message_id)

            await db.execute("""
                UPDATE learned_rules SET
                    times_confirmed = ?, confidence = ?, status = ?,
                    source_examples = ?, last_applied_at = datetime('now'),
                    last_updated_at = datetime('now')
                WHERE id = ?
            """, (new_confirmed, new_confidence, new_status, json.dumps(examples, ensure_ascii=False), existing["id"]))
            rule_id = existing["id"]
        else:
            # Contradicted — this existing rule was wrong for this case
            new_contradicted = existing["times_contradicted"] + 1
            new_confidence = compute_confidence(existing["times_confirmed"], new_contradicted)
            new_status = existing["status"]
            if new_confidence < RETIRE_THRESHOLD:
                new_status = "retired"
                logger.warning("[RULES] Retired rule #%d due to contradiction (confidence=%.2f)",
                                existing["id"], new_confidence)

            await db.execute("""
                UPDATE learned_rules SET
                    times_contradicted = ?, confidence = ?, status = ?,
                    last_updated_at = datetime('now')
                WHERE id = ?
            """, (new_contradicted, new_confidence, new_status, existing["id"]))
            rule_id = existing["id"]

            # Create a NEW candidate rule for the corrected action
            cursor = await db.execute("""
                INSERT INTO learned_rules (
                    rule_type, supplier_id, condition_pattern, condition_keywords,
                    action, confidence, times_confirmed, source_examples
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """, (rule_type, supplier_id, reason or "auto-generated", json.dumps(condition_keywords, ensure_ascii=False),
                  action, compute_confidence(1, 0), json.dumps([message_id], ensure_ascii=False)))
            rule_id = cursor.lastrowid
    else:
        # No matching rule — create a new candidate
        cursor = await db.execute("""
            INSERT INTO learned_rules (
                rule_type, supplier_id, condition_pattern, condition_keywords,
                action, confidence, times_confirmed, source_examples
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        """, (rule_type, supplier_id, reason or "auto-generated", json.dumps(condition_keywords, ensure_ascii=False),
              action, compute_confidence(1, 0), json.dumps([message_id], ensure_ascii=False)))
        rule_id = cursor.lastrowid
        logger.info("[RULES] New candidate rule #%d created: %s -> %s", rule_id, condition_keywords, action)

    # Log the correction event for audit trail
    await db.execute("""
        INSERT INTO rule_corrections (
            message_id, rule_id, old_step, new_step, correction_source, reason
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (message_id, rule_id,
          int(old_value) if old_value and old_value.isdigit() else None,
          int(new_value) if new_value.isdigit() else None,
          source, reason))

    await db.commit()
    return rule_id


async def get_active_rules(db, rule_type: str, supplier_id: Optional[int] = None) -> List[Dict]:
    """
    Fetch active rules to inject into local qwen prompts.
    Universal rules (supplier_id IS NULL) + supplier-specific rules for this supplier.
    """
    rows = await db.execute("""
        SELECT * FROM learned_rules
        WHERE rule_type = ? AND status = 'active'
          AND (supplier_id IS NULL OR supplier_id = ?)
        ORDER BY confidence DESC
        LIMIT 20
    """, (rule_type, supplier_id))
    return [dict(r) for r in await rows.fetchall()]


def format_rules_for_prompt(rules: List[Dict]) -> str:
    """Convert active rules into a prompt-friendly hint block for qwen."""
    if not rules:
        return ""
    lines = ["\nLEARNED PATTERNS (from prior corrections, apply when relevant):"]
    for r in rules:
        lines.append(f"- {r['condition_pattern']} → {r['action']} (confidence: {r['confidence']:.0%})")
    return "\n".join(lines)
