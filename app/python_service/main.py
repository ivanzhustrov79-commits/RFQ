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
    run_migration_002, run_migration_003,
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
        result = await upsert_email(request.model_dump())
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


# ── Run ──
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, log_level=LOG_LEVEL.lower())
