"""RFQ Flow Python Service - FastAPI Application"""
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from config import HOST, PORT, LOG_LEVEL, MAX_MBOX_SIZE_MB
from database import (
    init_db, close_db, upsert_email, query_emails,
    get_supplier_by_domain, upsert_supplier,
    queue_emails_for_nlp, get_next_nlp_pending, mark_nlp_processing,
    save_nlp_result, mark_nlp_failed, get_nlp_results, get_nlp_queue_stats,
    reset_stuck_processing, run_migration_004,
    get_supplier_id_by_sender, add_supplier_contact_email, get_supplier_contact_emails,
    run_migration_002, run_migration_003,
    reset_stuck_processing,
    get_or_create_supplier_by_folder, list_suppliers_with_stats,
)
from models import (
    HealthResponse, MboxParseRequest, MboxParseResponse,
    NlpExtractRequest, NlpExtractResponse, NlpClassifyRequest, NlpClassifyResponse,
    DbEmailRequest, DbEmailResponse, DbEmailsQueryResponse,
    DbSupplierRequest, DbSupplierWriteResponse, DbSupplierResponse,
    ErrorResponse,
)

# Logging
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Service state
_start_time: float = 0.0
_shutting_down: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    global _start_time
    logger.info("RFQ Flow Python Service starting...")
    await init_db()
    await run_migration_002()
    await run_migration_003()
    await run_migration_004()
    await reset_stuck_processing()
    _start_time = time.time()

    logger.info("Service ready on %s:%d", HOST, PORT)
    # Start background NLP worker
    asyncio.create_task(_nlp_background_worker())
    logger.info("Background NLP worker started")
    yield
    logger.info("Service shutting down...")
    _shutting_down = True
    await close_db()
    logger.info("Service stopped")


app = FastAPI(
    title="RFQ Flow Python Service",
    version="4.3.2",
    lifespan=lifespan,
)


# ── Middleware ──
@app.middleware("http")
async def log_requests(request, call_next):
    """Log all incoming requests."""
    if _shutting_down:
        return JSONResponse(
            status_code=503,
            content={"status": "shutting_down"},
        )
    start = time.time()
    response = await call_next(request)
    duration = (time.time() - start) * 1000
    logger.debug("%s %s -> %d (%.1fms)", request.method, request.url.path, response.status_code, duration)
    return response


# ─────────────────────────────────────────────────────────────
# 1.  NEW MODEL  (add near the other model imports at the top,
#     or just inline here — FastAPI doesn't care where it lives)
# ─────────────────────────────────────────────────────────────

# ── 1. NEW MODEL ──────────────────────────────────────────────────────────────
from pydantic import BaseModel

class EmailStepOverrideRequest(BaseModel):
    message_id: str          # identifies which email
    new_step: int            # 0–5
    previous_step: int = 0  # AI-assigned step (for deviation logging)


class RfqNameRequest(BaseModel):
    supplier_name: str          # e.g. "Camso"
    subject: str                # latest sent email subject
    body_text: str = ""         # sent email body (first 800 chars used)
    supplier_id: int            # for logging / future caching


# ── Phase 1: Health ──
@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint. Returns service status."""
    uptime = int(time.time() - _start_time)
    return HealthResponse(
        status="ok",
        version="4.3.2",
        services={"database": "ok", "nlp": "ok"},
        uptime_seconds=uptime,
    )


@app.post("/shutdown")
async def shutdown():
    """Graceful shutdown."""
    global _shutting_down
    _shutting_down = True
    logger.info("Shutdown requested")
    return {"status": "shutting_down"}


# ── Phase 2: MBOX Parsing ──
from mbox_parser import parse_mbox_file, MboxTooLargeError

@app.post("/mbox/parse", response_model=MboxParseResponse)
async def mbox_parse(request: MboxParseRequest):
    """
    Parse an MBOX file and extract emails.
    Phase 2: Uses mbox_parser module. Phase 4: adds NLP enrichment.
    """
    try:
        emails, total = parse_mbox_file(
            request.mbox_path,
            max_emails=request.max_emails,
            options=request.options,
        )
        path = Path(request.mbox_path)
        return MboxParseResponse(
            success=True,
            file=path.name,
            path=str(path),
            total_in_file=total,
            returned=len(emails),
            emails=emails,
        )
    except FileNotFoundError as e:
        logger.warning("MBOX not found: %s", e)
        raise HTTPException(status_code=404, detail={
            "success": False, "error": "FILE_NOT_FOUND",
            "error_detail": str(e),
        })
    except MboxTooLargeError as e:
        logger.warning("MBOX too large: %s", e)
        raise HTTPException(status_code=400, detail={
            "success": False, "error": "FILE_TOO_LARGE",
            "error_detail": str(e), "max_size_mb": MAX_MBOX_SIZE_MB,
        })
    except Exception as e:
        logger.error("MBOX parse error: %s", e)
        raise HTTPException(status_code=422, detail={
            "success": False, "error": "PARSE_ERROR",
            "error_detail": str(e),
        })


# ── Phase 3: Database ──
@app.post("/db/email", response_model=DbEmailResponse)
async def db_store_email(request: DbEmailRequest):
    """Store a parsed email in SQLite."""
    try:
        # Auto-resolve supplier_id from sender email if not provided
        data = request.model_dump()
        if not data.get("supplier_id") and data.get("sender_email"):
            resolved = await get_supplier_id_by_sender(data["sender_email"])
            if resolved:
                data["supplier_id"] = resolved

        result = await upsert_email(data)
        return DbEmailResponse(
            success=True,
            email_id=result["email_id"],
            action=result["action"],
        )
    except Exception as e:
        logger.error("DB email store error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "DB_ERROR", "error_detail": str(e),
        })


@app.get("/db/emails", response_model=DbEmailsQueryResponse)
async def db_get_emails(
    account: str = Query(..., description="Account email address"),
    folder: Optional[str] = Query(None, description="Folder path filter"),
    step: Optional[int] = Query(None, description="Workflow step filter"),
    supplier_id: Optional[int] = Query(None, description="Supplier ID filter"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """Query stored emails with filters."""
    try:
        result = await query_emails(
            account=account, folder=folder, step=step,
            supplier_id=supplier_id, limit=limit, offset=offset,
        )
        return DbEmailsQueryResponse(
            success=True,
            total=result["total"],
            returned=result["returned"],
            offset=result["offset"],
            emails=result["emails"],
        )
    except Exception as e:
        logger.error("DB query error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "DB_ERROR", "error_detail": str(e),
        })


# ── 2. NEW ROUTE ──────────────────────────────────────────────────────────────
@app.patch("/db/email/step")
async def db_override_email_step(request: EmailStepOverrideRequest):
    """
    Manual step override by the user.

    - Sets step_assigned to new_step in DB
    - Sets nlp_status = 'manual' so background worker never touches it again
    - Preserves original AI step + confidence in nlp_result for BOOST learning
    - User can call this again at any time to change it further

    Returns: { success: true, message_id, new_step, previous_step }
    """
    import json
    from database import get_db

    if not (0 <= request.new_step <= 5):
        raise HTTPException(status_code=400, detail="new_step must be 0–5")

    db = await get_db()

    # Load existing nlp_result so we can preserve AI classification data
    cursor = await db.execute(
        "SELECT nlp_result, step_assigned FROM emails WHERE message_id = ?",
        (request.message_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")

    existing_result = {}
    if row["nlp_result"]:
        try:
            existing_result = json.loads(row["nlp_result"])
        except json.JSONDecodeError:
            pass

    # Build updated result — preserve AI data, record override
    updated_result = {
        **existing_result,
        "step": request.new_step,
        "step_source": "manual",
        "ai_step": existing_result.get("step", request.previous_step),      # original AI step
        "ai_confidence": existing_result.get("confidence", 0),              # original confidence
        "override_from_step": request.previous_step,
        "override_at": __import__("datetime").datetime.utcnow().isoformat(),
    }

    await db.execute("""
        UPDATE emails
        SET step_assigned   = ?,
            nlp_status      = 'manual',
            nlp_result      = ?,
            nlp_enriched_at = datetime('now')
        WHERE message_id = ?
    """, (request.new_step, json.dumps(updated_result), request.message_id))
    await db.commit()

    logger.info(
        "[OVERRIDE] %s: step %d → %d (was AI=%d)",
        request.message_id[:30],
        request.previous_step,
        request.new_step,
        existing_result.get("step", request.previous_step),
    )

    return {
        "success": True,
        "message_id": request.message_id,
        "new_step": request.new_step,
        "previous_step": request.previous_step,
    }

@app.get("/db/email-supplier-map")
async def db_email_supplier_map():
    """
    Returns a mapping of message_id -> supplier_id for all emails that have
    a supplier_id set. Used by frontend to update React state on startup
    so supplier filtering works before NLP results arrive.
    """
    from database import get_db
    db = await get_db()
    cursor = await db.execute("""
        SELECT message_id, supplier_id, step_assigned, nlp_status
        FROM emails
        WHERE supplier_id IS NOT NULL
    """)
    rows = await cursor.fetchall()
    result = {}
    for row in rows:
        result[row["message_id"]] = {
            "supplier_id": row["supplier_id"],
            "step_assigned": row["step_assigned"],
            "nlp_status": row["nlp_status"],
        }
    return {"map": result, "count": len(result)}

# ── Supplier contact email management ────────────────────────────────────────

@app.get("/db/supplier/{supplier_id}/contacts")
async def get_supplier_contacts(supplier_id: int):
    """Get all contact email patterns for a supplier."""
    patterns = await get_supplier_contact_emails(supplier_id)
    return {"supplier_id": supplier_id, "patterns": patterns}


class AddContactEmailRequest(BaseModel):
    email_pattern: str   # full address like "ivy@cnspeedway.com" OR domain "@cnspeedway.com"


@app.post("/db/supplier/{supplier_id}/contacts")
async def add_supplier_contact(supplier_id: int, request: AddContactEmailRequest):
    """
    Add a contact email pattern to a supplier.
    Pattern can be:
      - Full address: "ivy@cnspeedway.com"  → match_type='address'
      - Domain:       "@cnspeedway.com"     → match_type='domain'

    After adding, re-links all existing unmatched emails that match this pattern.
    """
    pattern = request.email_pattern.strip().lower()
    match_type = "domain" if pattern.startswith("@") else "address"

    ok = await add_supplier_contact_email(supplier_id, pattern, match_type)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to add contact email")

    # Re-link existing emails that match this new pattern
    from database import get_db
    import re
    db = await get_db()
    if match_type == "address":
        await db.execute(
            "UPDATE emails SET supplier_id=? WHERE supplier_id IS NULL AND LOWER(sender_email) LIKE ?",
            (supplier_id, f"%{pattern}%")
        )
    else:
        domain = pattern[1:]  # strip leading @
        await db.execute(
            "UPDATE emails SET supplier_id=? WHERE supplier_id IS NULL AND LOWER(sender_email) LIKE ?",
            (supplier_id, f"%@{domain}%")
        )
    await db.commit()
    relinked = db.total_changes

    logger.info("[SUPPLIER] Added contact %s to supplier %d, relinked %d emails", pattern, supplier_id, relinked)
    return {
        "success": True,
        "supplier_id": supplier_id,
        "pattern": pattern,
        "match_type": match_type,
        "emails_relinked": relinked,
    }


@app.delete("/db/supplier/{supplier_id}/contacts")
async def delete_supplier_contact(supplier_id: int, pattern: str):
    """Delete a supplier contact email pattern."""
    from database import get_db
    db = await get_db()
    await db.execute(
        "DELETE FROM supplier_contact_emails WHERE supplier_id=? AND email_pattern=?",
        (supplier_id, pattern)
    )
    await db.commit()
    if db.total_changes == 0:
        raise HTTPException(status_code=404, detail="Pattern not found")
    # Clear upsert_email sender/supplier caches so next sync re-resolves
    logger.info("[SUPPLIER] Deleted contact pattern '%s' from supplier %d", pattern, supplier_id)
    return {"success": True, "deleted": pattern}


@app.get("/db/supplier-contact-patterns")
async def get_all_supplier_contact_patterns():
    """Get all supplier contact email patterns for address-based matching."""
    from database import get_db
    db = await get_db()
    rows = await db.execute("""
        SELECT supplier_id, email_pattern, match_type
        FROM supplier_contact_emails
        ORDER BY supplier_id
    """)
    patterns = await rows.fetchall()
    return {"patterns": [dict(p) for p in patterns]}


@app.get("/db/email/body/{message_id:path}")
async def get_email_body(message_id: str):
    """Fetch email body on demand (not stored in React state to save memory)."""
    from database import get_db
    db = await get_db()
    row = await db.execute(
        "SELECT body_text FROM emails WHERE message_id=?", (message_id,)
    )
    result = await row.fetchone()
    if not result:
        raise HTTPException(status_code=404, detail="Email not found")
    return {"body": result["body_text"] or ""}


@app.get("/db/thread-count")
async def get_thread_count():
    """Get total thread count for settings display."""
    from database import get_db
    db = await get_db()
    row = await db.execute("SELECT COUNT(*) as count FROM threads")
    result = await row.fetchone()
    return {"count": result["count"] if result else 0}


@app.get("/db/supplier/{supplier_id}/threads")
async def get_supplier_threads(supplier_id: int):
    """Get all threads for a supplier with email counts."""
    from database import get_db
    db = await get_db()
    rows = await db.execute("""
        SELECT
            t.id, t.supplier_id, t.subject_prefix,
            COUNT(e.id) as email_count,
            MIN(e.step_assigned) as earliest_step,
            MAX(e.step_assigned) as latest_step,
            MAX(e.sent_at) as last_email_at,
            SUM(CASE WHEN e.nlp_status IN ('completed','manual') THEN 1 ELSE 0 END) as enriched_count
        FROM threads t
        LEFT JOIN emails e ON e.thread_id = t.id
        WHERE t.supplier_id = ?
        GROUP BY t.id
        ORDER BY MAX(e.sent_at) DESC
    """, (supplier_id,))
    threads = await rows.fetchall()
    return {"threads": [dict(t) for t in threads]}


@app.get("/db/thread/{thread_id}")
async def get_thread_detail(thread_id: int):
    """Get emails and stats for a specific thread."""
    from database import get_db
    db = await get_db()

    # Get emails
    rows = await db.execute("""
        SELECT message_id, subject, sender_email, sender_name,
               sent_at, step_assigned, nlp_status, nlp_result
        FROM emails
        WHERE thread_id = ?
        ORDER BY sent_at ASC
    """, (thread_id,))
    emails = await rows.fetchall()

    # Get part numbers across thread from nlp_result JSON
    import json
    parts = set()
    for e in emails:
        if e['nlp_result']:
            try:
                nlp = json.loads(e['nlp_result'])
                for p in (nlp.get('part_numbers') or nlp.get('parts') or []):
                    if p:
                        parts.add(str(p))
            except:
                pass

    # Step distribution
    step_dist = {}
    for e in emails:
        step = str(e['step_assigned'] or 0)
        step_dist[step] = step_dist.get(step, 0) + 1

    return {
        "emails": [dict(e) for e in emails],
        "stats": {
            "part_numbers": list(parts),
            "step_distribution": step_dist,
            "email_count": len(emails),
        }
    }


class UpdateSupplierFolderRequest(BaseModel):
    folder_name: str  # e.g. "NINGBO" for NINGBO COMBINE


@app.patch("/db/supplier/{supplier_id}/folder")
async def update_supplier_folder(supplier_id: int, request: UpdateSupplierFolderRequest):
    """Update the Thunderbird folder name for a supplier."""
    from database import get_db
    db = await get_db()
    normalized = request.folder_name.strip().upper()
    await db.execute(
        "UPDATE suppliers SET folder_name_normalized=?, updated_at=datetime('now') WHERE id=?",
        (normalized, supplier_id)
    )
    await db.commit()
    if db.total_changes == 0:
        raise HTTPException(status_code=404, detail="Supplier not found")
    logger.info("[SUPPLIER] Updated folder for supplier %d: %s", supplier_id, normalized)
    return {"success": True, "supplier_id": supplier_id, "folder_name_normalized": normalized}


@app.get("/db/supplier", response_model=DbSupplierResponse)
async def db_get_supplier(domain: str = Query(..., description="Email domain")):
    """Get supplier by email domain."""
    try:
        supplier = await get_supplier_by_domain(domain)
        return DbSupplierResponse(
            success=True,
            found=supplier is not None,
            supplier=supplier,
        )
    except Exception as e:
        logger.error("DB supplier query error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "DB_ERROR", "error_detail": str(e),
        })


@app.post("/db/supplier", response_model=DbSupplierWriteResponse)
async def db_upsert_supplier(request: DbSupplierRequest):
    """Create or update a supplier."""
    try:
        result = await upsert_supplier(request.model_dump())
        return DbSupplierWriteResponse(
            success=True,
            supplier_id=result["supplier_id"],
            action=result["action"],
        )
    except Exception as e:
        logger.error("DB supplier write error: %s", e)
        raise HTTPException(status_code=500, detail={
            "success": False, "error": "DB_ERROR", "error_detail": str(e),
        })


# ── Phase 4+5: NLP + AI ──
from nlp.extractor import extract_rfq_data as heuristic_extract
from nlp.classifier import classify_email as heuristic_classify
from ai.pipeline import extract_rfq, classify_step
from models import RfqExtracted, StepClassification

@app.post("/nlp/extract-rfq", response_model=NlpExtractResponse)
async def nlp_extract_rfq(request: NlpExtractRequest):
    """
    Extract RFQ data from email (supplier name, part numbers).
    Phase 4: Uses regex + heuristics. Phase 5: Uses LLM for better accuracy.
    """
    try:
        extracted = extract_rfq(
            subject=request.subject,
            body_text=request.body_text,
            sender_domain=request.sender_domain,
            body_language=request.body_language,
        )
        return NlpExtractResponse(
            success=True,
            email_id=request.email_id,
            extracted=RfqExtracted(**extracted),
        )
    except Exception as e:
        logger.error("NLP extract error: %s", e)
        # Fallback: basic extraction
        return NlpExtractResponse(
            success=True,
            email_id=request.email_id,
            extracted=RfqExtracted(
                supplier_name=request.sender_domain.split(".")[0].upper() if request.sender_domain else None,
                supplier_name_confidence=0.1,
                part_numbers=[],
                rfq_name=None,
                rfq_name_source="auto",
                detected_language=request.body_language,
            ),
        )


@app.post("/nlp/classify-step", response_model=NlpClassifyResponse)
async def nlp_classify_step(request: NlpClassifyRequest):
    """
    Classify email to workflow step (1-7).
    Phase 4: Uses keyword heuristics. Phase 5: Uses LLM.
    """
    try:
        classification = classify_step(
            subject=request.subject,
            body_text=request.body_text,
            has_attachments=False,
            previous_emails=[{"step": p.step, "subject": request.subject} for p in request.previous_emails_in_thread] if request.previous_emails_in_thread else None,
        )
        return NlpClassifyResponse(
            success=True,
            email_id=request.email_id,
            classification=StepClassification(**classification),
        )
    except Exception as e:
        logger.error("NLP classify error: %s", e)
        # Fallback: default to step 1
        return NlpClassifyResponse(
            success=True,
            email_id=request.email_id,
            classification=StepClassification(
                suggested_step=1,
                step_name="RFQ Sent",
                confidence=0.2,
                reason="NLP failed, defaulting to step 1",
                alternative_steps=[],
                is_low_confidence=True,
                has_conflict=False,
            ),
        )


# ── Background NLP Worker ──
async def _nlp_background_worker():
    """Background worker: processes one email every 5 minutes with LLM.
    Runs continuously while the service is up."""
    # Wait a bit for service to fully start
    await asyncio.sleep(10)

    while not _shutting_down:
        try:
            # Check if Ollama is available
            from ai.ollama_client import is_available
            if not is_available():
                logger.debug("[BG-NLP] Ollama not available, skipping")
                await asyncio.sleep(300)  # Check again in 5 min
                continue

            # Get next pending email
            email = await get_next_nlp_pending()
            if not email:
                logger.debug("[BG-NLP] No pending emails in queue")
                await asyncio.sleep(300)  # Check again in 5 min
                continue

            email_id = email["id"]
            message_id = email["message_id"]
            logger.info("[BG-NLP] Processing email %d (msg_id=%s): %s",
                        email_id, message_id[:30], email["subject"][:50])

            # Mark as processing
            await mark_nlp_processing(email_id)

            # Run LLM enrichment (extract + classify in parallel)
            sender_domain = email["sender_email"].split("@")[-1] if "@" in email["sender_email"] else ""
            t0 = time.time()

            try:
                extracted = extract_rfq(
                    subject=email["subject"] or "",
                    body_text=email["body_text"] or "",
                    sender_domain=sender_domain,
                    body_language=email.get("body_language"),
                )
                classification = classify_step(
                    subject=email["subject"] or "",
                    body_text=email["body_text"] or "",
                    has_attachments=False,
                    previous_emails=None,
                )
                dt = time.time() - t0

                # Build result
                result = {
                    "supplier_name": extracted.get("supplier_name"),
                    "supplier_confidence": extracted.get("supplier_name_confidence", 0),
                    "part_numbers": [p.get("part_number", str(p)) if isinstance(p, dict) else str(p)
                                     for p in extracted.get("part_numbers", [])],
                    "step": classification.get("suggested_step", 0),
                    "step_name": classification.get("step_name", ""),
                    "confidence": classification.get("confidence", 0),
                    "reason": classification.get("reason", ""),
                    "processing_time_ms": int(dt * 1000),
                }

                await save_nlp_result(email_id, result)
                logger.info("[BG-NLP] Email %d enriched in %.1fs: step=%d, supplier=%s, conf=%.2f",
                            email_id, dt, result["step"], result["supplier_name"] or "-",
                            result["confidence"])

            except Exception as e:
                logger.error("[BG-NLP] Email %d enrichment failed: %s", email_id, e)
                await mark_nlp_failed(email_id)

            # Wait 5 minutes before processing next email
            await asyncio.sleep(300)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("[BG-NLP] Worker error: %s", e)
            await asyncio.sleep(300)

    logger.info("[BG-NLP] Background worker stopped")


# ── NLP Queue API ──

@app.post("/nlp/queue")
async def nlp_queue_emails(request: dict):
    """Queue emails for background LLM enrichment.
    Call this after loading emails from Thunderbird."""
    message_ids = request.get("message_ids", [])
    if not message_ids:
        return {"queued": 0, "message": "No message IDs provided"}

    queued = await queue_emails_for_nlp(message_ids)
    stats = await get_nlp_queue_stats()
    logger.info("[NLP-QUEUE] Queued %d emails for background enrichment. Stats: %s", queued, stats)
    return {"queued": queued, "stats": stats}


@app.post("/nlp/results")
async def nlp_get_results(request: dict):
    """Get NLP enrichment results for given message IDs.
    UI polls this every 30 seconds to update badges."""
    message_ids = request.get("message_ids", [])
    results = await get_nlp_results(message_ids)
    return {"results": results, "count": len(results)}


@app.get("/nlp/stats")
async def nlp_get_stats():
    """Get NLP queue statistics for the status bar."""
    stats = await get_nlp_queue_stats()
    return {"stats": stats}


# ── Cross-Mailbox Supplier Matching ──

@app.post("/db/supplier-by-folder")
async def db_supplier_by_folder(request: dict):
    """Get or create supplier by folder name.
    Same folder name across different mailboxes = same supplier."""
    folder_name = request.get("folder_name", "")
    email_domain = request.get("email_domain", "")
    sender_email = request.get("sender_email", "")

    if not folder_name:
        raise HTTPException(status_code=422, detail="folder_name required")

    result = await get_or_create_supplier_by_folder(
        folder_name=folder_name,
        email_domain=email_domain,
        sender_email=sender_email,
    )
    return {
        "success": True,
        "supplier_id": result["supplier_id"],
        "name": result["name"],
        "action": result["action"],
    }


@app.get("/db/suppliers")
async def db_list_suppliers():
    """List all suppliers with email counts (across all mailboxes)."""
    suppliers = await list_suppliers_with_stats()
    return {"suppliers": suppliers, "count": len(suppliers)}

# ─────────────────────────────────────────────────────────────
# 2.  NEW ROUTE  (paste after /db/suppliers, before # ── Run ──)
# ─────────────────────────────────────────────────────────────
@app.post("/rfq/generate-name")
async def rfq_generate_name(request: RfqNameRequest):
    """
    Ask Ollama to generate a short human-readable RFQ name.
    Format:  <Supplier> — <product summary>
    e.g.    "Camso — track assembly x4"

    Called by Electron main.cjs via callPython() when the first
    outbound (isSentByUser=true) email for a supplier is detected.

    Returns:
        { "rfq_name": "Camso — track assembly x4", "source": "ai" }
    Falls back to rule-based name if Ollama is unavailable.
    """
    from ai.ollama_client import generate_json, is_available

    supplier = request.supplier_name.strip() or f"Supplier #{request.supplier_id}"

    # ── Fallback: build a name without LLM ──
    def _fallback_name() -> dict:
        subj = request.subject.strip()
        # Strip common noise prefixes (Re:, Fwd:, FW:, AW:, etc.)
        import re
        subj = re.sub(r'^(re|fwd?|aw|sv)[\s:]+', '', subj, flags=re.IGNORECASE).strip()
        name = f"{supplier} — {subj[:45]}" if subj else supplier
        return {"rfq_name": name, "source": "rule"}

    if not is_available():
        logger.info("[RFQ-NAME] Ollama unavailable, using rule fallback for supplier %d", request.supplier_id)
        return _fallback_name()

    # Truncate body to keep prompt fast
    body_snippet = request.body_text[:800].strip()
    subject_clean = request.subject.strip()

    prompt = f"""You are a procurement assistant. Your job is to create a short, descriptive RFQ name.

Supplier: {supplier}
Email subject: {subject_clean}
Email body excerpt:
{body_snippet}

Rules:
- Format MUST be: "<Supplier> — <product summary>"
- Product summary: 2–6 words, focus on product type and key spec (quantity, size, model)
- Examples: "Camso — track assembly x4", "Parker — hydraulic valve DN50 x2", "SKF — bearing 6205 x100"
- Do NOT include dates, RFQ numbers, or email metadata
- Respond ONLY with JSON: {{"rfq_name": "..."}}
"""

    result = generate_json(prompt, temperature=0.15)

    if result and isinstance(result.get("rfq_name"), str) and len(result["rfq_name"]) > 3:
        name = result["rfq_name"].strip()
        # Safety: ensure supplier name is present (LLM sometimes drops it)
        if supplier.lower() not in name.lower():
            name = f"{supplier} — {name}"
        logger.info("[RFQ-NAME] AI name for supplier %d: %s", request.supplier_id, name)
        return {"rfq_name": name, "source": "ai"}

    logger.warning("[RFQ-NAME] AI returned bad result for supplier %d, using fallback", request.supplier_id)
    return _fallback_name()


# ── Run ──
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level=LOG_LEVEL.lower())
