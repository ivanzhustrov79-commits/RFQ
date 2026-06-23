# ============================================================================
# FastAPI routes — Sync Reliability + Tiered Learning  (v2, corrected against
# the real main.py you uploaded)
#
# WHAT CHANGED FROM THE FIRST DRAFT:
# - Matches your real convention exactly: `from database import get_db` is
#   imported LOCALLY inside each route handler that needs it (see your own
#   db_override_email_step at line 233-246 of main.py) — not as a top-level
#   import. Kept consistent here.
# - Query params use `Query(...)` with descriptions, matching db_get_emails'
#   style (account/folder/step/supplier_id), not bare Python defaults.
# - Confirmed via your imports block: `get_supplier_id_by_sender` is a
#   database.py function (already imported at the top of main.py) — the
#   Tier 2 fix in sync_reliability.py correctly assumes this; no change
#   needed there.
# - Insert this block right before the `# ── Run ──` / `if __name__ ==
#   "__main__":` section at the very end of main.py.
# - Add `import sync_reliability` near your other top-level imports (it's
#   fine as a top-level import since, unlike get_db, it's not duplicating
#   an existing local-import convention — it's a new module, not a
#   database.py function).
# ============================================================================

from pydantic import BaseModel
import sync_reliability


class VerifySyncRequest(BaseModel):
    account_email: str
    folder_path: str
    expected_count: int


class VerifySyncResponse(BaseModel):
    account_email: str
    folder_path: str
    expected_count: int
    actual_count: int
    is_match: bool
    missing_count: int


@app.post("/db/verify-sync", response_model=VerifySyncResponse)
async def db_verify_sync(request: VerifySyncRequest):
    """
    Called by Electron once per folder right after parseMboxEmailsStreaming
    finishes (totalProcessed is known). Compares that count against what's
    actually persisted in the DB for the account/folder.
    """
    try:
        result = await sync_reliability.verify_sync_completeness(
            request.account_email, request.folder_path, request.expected_count
        )
        return VerifySyncResponse(**result)
    except Exception as e:
        logger.error("Sync verification error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "VERIFY_ERROR", "error_detail": str(e),
        })


@app.get("/db/sync-failures")
async def db_get_sync_failures(
    status: str = Query("pending,retrying,escalated", description="Comma-separated statuses to filter by"),
):
    """
    Returns active sync failures matching any of the comma-separated statuses.
    Used by Electron to find a failure record for a folder (to drive retries)
    and by the renderer (via IPC) to populate the alarm banner.
    """
    from database import get_db

    db = await get_db()
    statuses = [s.strip() for s in status.split(",")]
    placeholders = ",".join("?" * len(statuses))
    cursor = await db.execute(
        f"SELECT * FROM sync_failures WHERE status IN ({placeholders}) ORDER BY first_detected_at DESC",
        statuses,
    )
    rows = await cursor.fetchall()
    return {"items": [dict(r) for r in rows]}


@app.post("/db/sync-retry/{failure_id}")
async def db_sync_retry(failure_id: int):
    """
    Increments the retry counter for a failure. Returns whether Electron
    should attempt another re-sync (retry=True) or stop and surface the
    alarm (escalate=True, with the bundled report).
    """
    try:
        result = await sync_reliability.attempt_retry(failure_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Sync retry error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "RETRY_ERROR", "error_detail": str(e),
        })


@app.post("/db/sync-resolve/{failure_id}")
async def db_sync_resolve(failure_id: int):
    """Called by Electron once a retry's verify-sync call comes back is_match=true."""
    await sync_reliability.mark_resolved(failure_id)
    return {"success": True}


@app.post("/db/sync-escalate/{failure_id}")
async def db_sync_escalate(failure_id: int):
    """
    The one-click 'Send to Deepseek' action triggered from the alarm banner.
    NOTE: currently raises NotImplementedError via send_to_deepseek() until
    the actual Deepseek HTTP call is wired in (see sync_reliability.py's
    send_to_deepseek stub) — intentional, so no API tokens are spent before
    that's confirmed working end to end. Surfaces as a 501 to the renderer,
    which can show "Not configured yet" instead of a generic error.
    """
    try:
        from config import DEEPSEEK_API_KEY, DEEPSEEK_API_URL
        result = await sync_reliability.send_to_deepseek(
            failure_id, DEEPSEEK_API_KEY, DEEPSEEK_API_URL
        )
        fix_id = await sync_reliability.record_learned_fix(failure_id, result)
        applied = await sync_reliability.apply_learned_fix(fix_id)
        return {"success": True, "fix_id": fix_id, "applied": applied}
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error("Deepseek escalation error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "ESCALATE_ERROR", "error_detail": str(e),
        })
