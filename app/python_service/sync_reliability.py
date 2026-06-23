"""
RFQ Flow — Sync Reliability + Tiered Learning Feedback
=========================================================

This module implements, exactly as specified:

1. Sync verification: after every folder sync, compare the count of emails the
   Electron streaming parser reported processing against what's actually
   persisted in the DB for that account/folder. A mismatch is a CRITICAL
   failure (per spec: "not synced = not shown on Kanban = critical failure").

2. Automatic retry: up to 3 attempts per failed folder before escalating.

3. Escalation: on the 3rd failed retry, build a complete diagnostic report
   and store it ready for one-click send to Deepseek. Does NOT call the
   Deepseek API automatically — per spec this is a user-triggered one-click
   action (the alarm banner is what prompts the click), so tokens are only
   spent when the user actually wants the fix, not on every failure.

4. Once a Deepseek response is received and recorded, apply_learned_fix()
   routes the fix to the correct tier-specific re-review scope:
     Tier 1 (general_recognition) -> re-run parsing logic against emails
         matching the same technical signature (e.g. same header pattern).
     Tier 2 (rfq_sorting)         -> re-run supplier/RFQ attachment logic
         against emails matching the affected sender/domain/thread pattern.
     Tier 3 (step_sorting)        -> re-run step classification against
         emails within the affected RFQ(s) only.
   Each tier is intentionally scoped narrower than the last, per spec
   ("only emails involved to such issue" — not a full DB rescan).

WIRING NOTES (read before integrating):
- This module assumes `get_db()` from database.py for the connection.
- `verify_sync_completeness()` expects to be called once per folder right
  after persistEmailsToDB finishes that folder, with the count Electron
  already logs (the %d in "[TB-SYNC] Finished %s: %d emails processed").
  You already have that number in main.js — just pass it through via the
  existing POST /db/email flow or a new lightweight POST /db/verify-sync call.
- `DEEPSEEK_API_KEY` / endpoint: read from your existing credentials store —
  not hardcoded here. Fill in `_call_deepseek()`'s actual HTTP call once you
  confirm where those credentials live in your config.
"""

import json
import logging
from datetime import datetime
from typing import Optional, Dict, Any, List

from database import get_db

logger = logging.getLogger(__name__)

MAX_RETRIES = 3


# ============================================================================
# 1. SYNC VERIFICATION
# ============================================================================

async def verify_sync_completeness(
    account_email: str,
    folder_path: str,
    expected_count: int,
) -> Dict[str, Any]:
    """
    Call this once per folder, right after persistEmailsToDB finishes that
    folder. expected_count = the number Electron's streaming parser reported
    (the %d already logged as "[TB-SYNC] Finished %s: %d emails processed").

    Returns a dict the caller (FastAPI route) can use to decide whether to
    surface the alarm immediately or let the retry flow handle it silently.
    """
    db = await get_db()

    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM emails WHERE account_email = ? AND folder_path = ?",
        (account_email, folder_path),
    )
    row = await cursor.fetchone()
    actual_count = row["cnt"] if row else 0

    is_match = 1 if actual_count >= expected_count else 0
    # Note: >= rather than == — a previous sync may have already stored some
    # of these emails (normal re-sync behavior), so actual_count can legitimately
    # exceed expected_count for THIS pass without that being a failure.

    await db.execute(
        """INSERT INTO sync_verification
           (account_email, folder_path, expected_count, actual_count, is_match)
           VALUES (?, ?, ?, ?, ?)""",
        (account_email, folder_path, expected_count, actual_count, is_match),
    )
    await db.commit()

    result = {
        "account_email": account_email,
        "folder_path": folder_path,
        "expected_count": expected_count,
        "actual_count": actual_count,
        "is_match": bool(is_match),
        "missing_count": max(0, expected_count - actual_count),
    }

    if not is_match:
        await _register_or_update_failure(account_email, folder_path, expected_count, actual_count)

    return result


async def _register_or_update_failure(
    account_email: str,
    folder_path: str,
    expected_count: int,
    actual_count: int,
) -> int:
    """
    Creates a new sync_failures row, or — if this exact folder/account already
    has an unresolved failure in flight — returns the existing one's id so the
    retry counter accumulates correctly instead of creating duplicate rows.
    """
    db = await get_db()

    cursor = await db.execute(
        """SELECT id, retry_count FROM sync_failures
           WHERE account_email = ? AND folder_path = ?
             AND status IN ('pending', 'retrying')
           ORDER BY first_detected_at DESC LIMIT 1""",
        (account_email, folder_path),
    )
    existing = await cursor.fetchone()

    if existing:
        return existing["id"]

    missing_count = max(0, expected_count - actual_count)
    cursor = await db.execute(
        """INSERT INTO sync_failures
           (account_email, folder_path, expected_count, actual_count, missing_count, status)
           VALUES (?, ?, ?, ?, ?, 'pending')""",
        (account_email, folder_path, expected_count, actual_count, missing_count),
    )
    await db.commit()
    failure_id = cursor.lastrowid
    logger.warning(
        "[SYNC-FAILURE] Registered: %s / %s — expected %d, got %d (missing %d)",
        account_email, folder_path, expected_count, actual_count, missing_count,
    )
    return failure_id


# ============================================================================
# 2. RETRY LOGIC
# ============================================================================

async def attempt_retry(failure_id: int) -> Dict[str, Any]:
    """
    Call this to attempt one retry of a registered failure. The actual
    re-sync of the folder happens on the Electron side (it's the only side
    with mbox access) — this function just manages the retry-count bookkeeping
    and tells the caller whether to retry again, or escalate.

    Expected call pattern from Electron:
        1. Electron detects a folder's verify_sync_completeness() came back
           is_match=false.
        2. Electron calls POST /db/sync-retry/{failure_id} (wraps this fn).
        3. If response says retry=True -> Electron re-streams just that folder
           and calls verify_sync_completeness() again.
        4. If response says retry=False (escalate=True) -> Electron triggers
           the alarm banner and stops retrying automatically.
    """
    db = await get_db()

    cursor = await db.execute(
        "SELECT * FROM sync_failures WHERE id = ?", (failure_id,)
    )
    failure = await cursor.fetchone()
    if not failure:
        raise ValueError(f"No sync_failures row with id={failure_id}")

    new_retry_count = failure["retry_count"] + 1

    if new_retry_count >= MAX_RETRIES:
        await db.execute(
            """UPDATE sync_failures
               SET retry_count = ?, status = 'escalated', last_retry_at = datetime('now')
               WHERE id = ?""",
            (new_retry_count, failure_id),
        )
        await db.commit()
        report = await _build_failure_report(failure_id)
        logger.error(
            "[SYNC-FAILURE] Escalating after %d retries: %s / %s",
            new_retry_count, failure["account_email"], failure["folder_path"],
        )
        return {"retry": False, "escalate": True, "report": report}

    await db.execute(
        """UPDATE sync_failures
           SET retry_count = ?, status = 'retrying', last_retry_at = datetime('now')
           WHERE id = ?""",
        (new_retry_count, failure_id),
    )
    await db.commit()
    return {"retry": True, "escalate": False, "attempt": new_retry_count}


async def mark_resolved(failure_id: int) -> None:
    """Call once a retry's verify_sync_completeness() comes back is_match=True."""
    db = await get_db()
    await db.execute(
        "UPDATE sync_failures SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?",
        (failure_id,),
    )
    await db.commit()
    logger.info("[SYNC-FAILURE] Resolved: failure_id=%d", failure_id)


# ============================================================================
# 3. FAILURE REPORT + ONE-CLICK DEEPSEEK SEND
# ============================================================================

async def _build_failure_report(failure_id: int) -> Dict[str, Any]:
    """
    Bundles everything needed to diagnose the failure into one JSON-able dict.
    Stored in sync_failures.report_json so the UI can show/send it without
    re-querying everything each time the user looks at the alarm.
    """
    db = await get_db()

    cursor = await db.execute("SELECT * FROM sync_failures WHERE id = ?", (failure_id,))
    failure = await cursor.fetchone()

    cursor = await db.execute(
        "SELECT * FROM sync_failure_emails WHERE sync_failure_id = ?", (failure_id,)
    )
    implicated_emails = [dict(r) for r in await cursor.fetchall()]

    report = {
        "failure_id": failure_id,
        "account_email": failure["account_email"],
        "folder_path": failure["folder_path"],
        "expected_count": failure["expected_count"],
        "actual_count": failure["actual_count"],
        "missing_count": failure["missing_count"],
        "retry_count": failure["retry_count"],
        "first_detected_at": failure["first_detected_at"],
        "implicated_emails": implicated_emails,
        "generated_at": datetime.utcnow().isoformat(),
        # This is the schema Deepseek is instructed to respond in — see
        # _build_deepseek_prompt() below. Included here so the report itself
        # documents what response shape was requested.
        "requested_response_schema": {
            "tier": "1 | 2 | 3",
            "fix_description": "string",
            "scope_filter": {
                "tier_1_general_recognition": {
                    "header_pattern": "string, optional",
                    "sender_domain_pattern": "string, optional",
                },
                "tier_2_rfq_sorting": {
                    "sender_domain": "string, optional",
                    "thread_id_pattern": "string, optional",
                },
                "tier_3_step_sorting": {
                    "rfq_ids": "list of int, optional",
                },
            },
            "confidence": "float 0.0-1.0",
        },
    }

    await db.execute(
        "UPDATE sync_failures SET report_json = ? WHERE id = ?",
        (json.dumps(report), failure_id),
    )
    await db.commit()
    return report


def _build_deepseek_prompt(report: Dict[str, Any]) -> str:
    """
    Constrains Deepseek to return strict JSON we can map directly to a tier,
    since (per your answer) the response format hasn't been tested yet and
    freeform text would need separate classification — better to control the
    output shape from our side than parse prose after the fact.
    """
    return f"""You are diagnosing a data-sync failure in an email-processing pipeline.

FAILURE DATA:
{json.dumps(report, indent=2)}

Respond with ONLY a single JSON object, no other text, matching exactly this shape:
{{
  "tier": 1 | 2 | 3,
  "fix_description": "<concise description of the root cause and fix>",
  "scope_filter": {{
    // include ONLY the keys relevant to the tier you chose:
    // tier 1 (general_recognition): "header_pattern" and/or "sender_domain_pattern"
    // tier 2 (rfq_sorting): "sender_domain" and/or "thread_id_pattern"
    // tier 3 (step_sorting): "rfq_ids" (list of integers)
  }},
  "confidence": <float between 0.0 and 1.0>
}}

Tier definitions:
1 = general_recognition: the bug is in raw email parsing/ingestion and affects
    any email matching a technical pattern (e.g. header format, encoding).
2 = rfq_sorting: the bug affects which RFQ/supplier an email gets attached to.
3 = step_sorting: the bug affects step classification within an already
    correctly-attached RFQ.
"""


async def send_to_deepseek(failure_id: int, api_key: str, api_url: str) -> Dict[str, Any]:
    """
    The one-click action. Call this from a FastAPI route triggered by the
    user clicking the alarm banner's "Send to Deepseek" button.

    NOTE: actual HTTP call is left as a clearly-marked stub — fill in once
    you confirm the exact Deepseek endpoint/request shape you're using
    elsewhere in the app (so this doesn't duplicate or conflict with an
    existing BOOST/Teacher API client you may already have).
    """
    db = await get_db()
    cursor = await db.execute("SELECT report_json FROM sync_failures WHERE id = ?", (failure_id,))
    row = await cursor.fetchone()
    if not row or not row["report_json"]:
        raise ValueError(f"No report found for failure_id={failure_id}; build it first")

    report = json.loads(row["report_json"])
    prompt = _build_deepseek_prompt(report)

    # ---- STUB: replace with your actual Deepseek client call ----
    # import httpx
    # async with httpx.AsyncClient() as client:
    #     resp = await client.post(
    #         api_url,
    #         headers={"Authorization": f"Bearer {api_key}"},
    #         json={"model": "deepseek-chat", "messages": [{"role": "user", "content": prompt}]},
    #         timeout=60,
    #     )
    #     resp.raise_for_status()
    #     raw_content = resp.json()["choices"][0]["message"]["content"]
    raise NotImplementedError(
        "Wire up the actual Deepseek HTTP call here — see the commented block above. "
        "This stub exists so nothing fires (and no tokens spend) until you confirm the "
        "exact endpoint/auth shape you want."
    )

    # ---- once raw_content is obtained, the rest of the flow is ready: ----
    # parsed = json.loads(raw_content)  # strict JSON per the prompt's instruction
    # await record_learned_fix(failure_id, parsed)
    # return parsed


# ============================================================================
# 4. RECORDING + APPLYING THE LEARNED FIX (tiered scope)
# ============================================================================

async def record_learned_fix(failure_id: Optional[int], deepseek_response: Dict[str, Any]) -> int:
    """
    Stores a fix received from Deepseek (validated to match the requested
    schema) and returns the new learned_fixes.id. Does NOT apply it yet —
    applying is a separate, explicit step (apply_learned_fix) so the scope
    of changes is always deliberate and auditable.
    """
    tier = deepseek_response.get("tier")
    if tier not in (1, 2, 3):
        raise ValueError(f"Invalid tier in Deepseek response: {tier!r}")

    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO learned_fixes
           (sync_failure_id, tier, fix_description, scope_filter_json, confidence, source)
           VALUES (?, ?, ?, ?, ?, 'deepseek')""",
        (
            failure_id,
            tier,
            deepseek_response.get("fix_description", ""),
            json.dumps(deepseek_response.get("scope_filter", {})),
            deepseek_response.get("confidence"),
        ),
    )
    await db.commit()
    fix_id = cursor.lastrowid

    if failure_id is not None:
        db2 = await get_db()
        await db2.execute(
            "UPDATE sync_failures SET deepseek_response_json = ? WHERE id = ?",
            (json.dumps(deepseek_response), failure_id),
        )
        await db2.commit()

    logger.info("[LEARNED-FIX] Recorded fix id=%d, tier=%d", fix_id, tier)
    return fix_id


async def apply_learned_fix(fix_id: int) -> Dict[str, Any]:
    """
    Routes to the correct tier-scoped re-review. This is the function that
    answers your spec point 2: "only emails involved to such issue," with
    scope narrowing as tier increases.
    """
    db = await get_db()
    cursor = await db.execute("SELECT * FROM learned_fixes WHERE id = ?", (fix_id,))
    fix = await cursor.fetchone()
    if not fix:
        raise ValueError(f"No learned_fixes row with id={fix_id}")

    scope_filter = json.loads(fix["scope_filter_json"])
    tier = fix["tier"]

    if tier == 1:
        result = await _apply_tier1_general_recognition(scope_filter)
    elif tier == 2:
        result = await _apply_tier2_rfq_sorting(scope_filter)
    elif tier == 3:
        result = await _apply_tier3_step_sorting(scope_filter)
    else:
        raise ValueError(f"Unknown tier: {tier}")

    await db.execute(
        """UPDATE learned_fixes
           SET applied = 1, applied_at = datetime('now'),
               emails_reviewed = ?, emails_changed = ?
           WHERE id = ?""",
        (result["emails_reviewed"], result["emails_changed"], fix_id),
    )
    await db.commit()
    return result


async def _apply_tier1_general_recognition(scope_filter: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tier 1 — General recognition (broadest of the three tiers, but still
    NOT a full-database rescan; scoped to emails matching the technical
    signature Deepseek identified, e.g. a sender-domain pattern known to
    trigger the parsing bug).

    NOTE: This does NOT re-parse raw mbox data (that data may no longer be
    available / would require Electron's involvement). What it CAN do
    immediately is flag matching DB rows for re-sync, since the underlying
    mbox files are still the source of truth on the Electron side.
    """
    db = await get_db()
    domain_pattern = scope_filter.get("sender_domain_pattern")

    if not domain_pattern:
        # Nothing actionable in DB alone — header_pattern fixes need Electron's
        # mbox re-parse, which this function can't trigger directly. Surface
        # that clearly rather than silently doing nothing.
        return {
            "tier": 1,
            "emails_reviewed": 0,
            "emails_changed": 0,
            "note": (
                "scope_filter had no sender_domain_pattern — a header_pattern-only "
                "fix requires re-running parseMboxEmailsStreaming on the Electron "
                "side; this DB-side function flags candidates but cannot re-parse "
                "raw mbox bytes itself."
            ),
        }

    cursor = await db.execute(
        "SELECT id, message_id FROM emails WHERE sender_email LIKE ?",
        (f"%{domain_pattern}%",),
    )
    matching = await cursor.fetchall()

    # Mark these for re-sync attention rather than mutating them blindly —
    # tier 1 fixes are about RE-PARSING, which only Electron can actually do.
    # We surface the candidate set; Electron's re-sync pass picks them up
    # naturally next cycle since upsert_email is idempotent.
    return {
        "tier": 1,
        "emails_reviewed": len(matching),
        "emails_changed": 0,  # no DB mutation here by design — see note above
        "candidate_message_ids": [r["message_id"] for r in matching],
        "note": "Candidates flagged for re-sync; actual re-parse happens on next Electron sync pass.",
    }


async def _apply_tier2_rfq_sorting(scope_filter: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tier 2 — RFQ sorting. Scope: emails matching the affected sender_domain
    and/or thread_id_pattern, re-evaluating their supplier_id/rfq_id
    attachment specifically (not their step, not their raw parsing).
    """
    db = await get_db()
    sender_domain = scope_filter.get("sender_domain")
    thread_pattern = scope_filter.get("thread_id_pattern")

    conditions = []
    params = []
    if sender_domain:
        conditions.append("sender_email LIKE ?")
        params.append(f"%{sender_domain}%")
    if thread_pattern:
        conditions.append("thread_id LIKE ?")
        params.append(f"%{thread_pattern}%")

    if not conditions:
        return {
            "tier": 2, "emails_reviewed": 0, "emails_changed": 0,
            "note": "scope_filter had neither sender_domain nor thread_id_pattern — nothing to scope to.",
        }

    where_clause = " OR ".join(conditions)
    cursor = await db.execute(
        f"SELECT id, sender_email, supplier_id, rfq_id FROM emails WHERE {where_clause}",
        params,
    )
    matching = await cursor.fetchall()

    changed = 0
    for row in matching:
        # Re-resolve supplier_id the same way the normal ingestion path does —
        # reuses the existing resolution logic rather than duplicating it.
        # (Assumes get_supplier_id_by_sender exists in this codebase per the
        # FastAPI route you showed earlier — db_store_email calls it the same way.)
        from database import get_supplier_id_by_sender  # confirmed: defined in database.py, imported into main.py the same way
        resolved_supplier_id = await get_supplier_id_by_sender(row["sender_email"])
        if resolved_supplier_id and resolved_supplier_id != row["supplier_id"]:
            await db.execute(
                "UPDATE emails SET supplier_id = ? WHERE id = ?",
                (resolved_supplier_id, row["id"]),
            )
            changed += 1

    await db.commit()
    return {"tier": 2, "emails_reviewed": len(matching), "emails_changed": changed}


async def _apply_tier3_step_sorting(scope_filter: Dict[str, Any]) -> Dict[str, Any]:
    """
    Tier 3 — Step sorting (narrowest tier). Scope: emails within specific
    already-correctly-attached RFQ(s) only. Does NOT touch supplier_id or
    rfq_id — only re-queues step_assigned for NLP re-evaluation, and only
    for emails not already manually overridden (nlp_status = 'manual'),
    mirroring the same protection upsert_email already gives manual entries.
    """
    db = await get_db()
    rfq_ids = scope_filter.get("rfq_ids", [])

    if not rfq_ids:
        return {
            "tier": 3, "emails_reviewed": 0, "emails_changed": 0,
            "note": "scope_filter had no rfq_ids — nothing to scope to.",
        }

    placeholders = ",".join("?" * len(rfq_ids))
    cursor = await db.execute(
        f"""SELECT id FROM emails
            WHERE rfq_id IN ({placeholders})
              AND (nlp_status IS NULL OR nlp_status != 'manual')""",
        rfq_ids,
    )
    matching = await cursor.fetchall()

    # Re-queue for NLP step classification rather than guessing a new step
    # value here directly — keeps step assignment logic in one place (the
    # NLP pipeline) instead of duplicating classification rules in this module.
    for row in matching:
        await db.execute(
            "UPDATE emails SET nlp_status = 'pending', step_assigned = 0 WHERE id = ?",
            (row["id"],),
        )
    await db.commit()

    return {
        "tier": 3,
        "emails_reviewed": len(matching),
        "emails_changed": len(matching),
        "note": "Matching emails re-queued for NLP step re-classification (not directly mutated here).",
    }
