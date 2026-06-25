"""
BOOST Pipeline - Thread-level AI verification via cloud API
Place in python_service/ai/boost_pipeline.py
"""
import json
import logging
from typing import List, Dict, Any, Optional
from .boost_client import chat_json, is_configured

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert procurement analyst for agricultural machinery parts.
You analyze email threads between buyers and suppliers to classify each email in the procurement workflow.

Workflow steps (4-step taxonomy):
0: PR (Purchase Request) — INTERNAL ONLY, never supplier-facing. The buyer's boss asking
   them to source something, or the buyer confirming they'll handle it. If an email
   involves a supplier at all (sender_role=supplier, or clearly addressed to one), it is
   NOT step 0 — classify it as step 1 (RFQ) instead.
1: RFQ — covers both sending a supplier a request for quotation AND receiving their
   price/availability answer. One merged step for the whole "ask and get quoted" phase.
2: CI — covers price negotiation, invoice/PI exchange, and final confirmation/approval of
   the deal. One merged step for the whole "agree on the deal" phase.
3: Downpayment — anything specifically about prepayment/advance payment/deposit for this
   order: confirming it was sent, asking about it, or confirming receipt.

Each email is tagged with its sender_role: "user" (the buyer sent it), "supplier" (the
supplier sent it), "boss" (the buyer's boss sent it), or "unknown". This is a DATA FACT
provided to you, not something to infer from the email's tone or content — use it directly.

You understand Russian, English, and Chinese procurement terminology.
Russian keywords: расценка=quote, инвойс=invoice, оплата=payment, отгрузка=shipment, 
платеж=payment, проформа=proforma, доставка=delivery, SWIFT=payment confirmation,
предоплата/аванс=prepayment/advance

In addition to the step, you assess SIGNAL — whether THIS email represents that step's
defining success condition, an explicit hold/cancellation, or neither. Be conservative:
only mark "advances" when the condition is clearly, unambiguously met.

  - Step 1 (RFQ) "advances": the SUPPLIER (sender_role=supplier) is confirming they
    received/are answering the RFQ. The buyer's own outgoing request is "neutral" here,
    not "advances" — only the supplier's confirmation counts.
  - Step 2 (CI) "advances": the BUYER (sender_role=user) is sending the supplier
    approval/acceptance of their invoice, PI, or CI. The supplier SENDING the invoice is
    "neutral" — only the buyer's approval of it counts.
  - Step 3 (Downpayment) "advances": ANY of — the buyer confirming to the supplier that
    prepayment was made; the buyer's boss messaging about prepayment for this order; OR
    the supplier confirming they received the prepayment.
  - Step 0 (PR): signal is always "neutral" — PR has no success/hold tracking at all.
  - "holds" (steps 1-3 only): this email explicitly pauses, postpones, or cancels
    progress on this step — e.g. "let's hold off", "cancel this order", "we need to pause".
  - "neutral": anything not meeting the above — most routine correspondence, including
    ordinary back-and-forth that doesn't itself represent the step's defining success
    condition.

You also assess SIGNIFICANCE: is_significant=true means the email substantively advances
the business (actual prices, part lists, decisions, confirmations). is_significant=false
means small talk, greetings, "will check later" with no real content, or internal chatter
that doesn't matter for tracking the deal. This is a SEPARATE judgment from step assignment —
an email can be confidently step-classified yet still be insignificant noise within that step."""


async def verify_thread(thread_id: int, emails: List[Dict]) -> Optional[List[Dict]]:
    """
    Send full thread to BOOST API for verification.
    Returns list of {message_id, step, confidence, signal_type, signal_confidence,
    parts, supplier_name, is_significant, significance_confidence} or None.

    Each dict in `emails` should include a "sender_role" key ("boss"|"user"|"supplier"|
    "unknown" — see database.determine_sender_role) so BOOST can judge signal_type
    directionally, the same way pipeline.py's classify_step_llm does. Defaults to
    "unknown" if the caller hasn't attached it yet.
    """
    if not is_configured():
        return None

    if not emails:
        return None

    # Build thread summary for API
    thread_text = []
    for i, e in enumerate(emails):
        sender = e.get("sender_email", "unknown")
        sender_role = e.get("sender_role", "unknown")
        subject = e.get("subject", "(no subject)")
        # Truncate body to save tokens
        body = (e.get("body_text") or "")[:400].strip()
        current_step = e.get("step_assigned", 0)
        thread_text.append(
            f"Email {i+1} [ID:{e.get('message_id','?')}] [CurrentStep:{current_step}] [SenderRole:{sender_role}]\n"
            f"From: {sender}\n"
            f"Subject: {subject}\n"
            f"Body: {body}\n"
        )

    thread_summary = "\n---\n".join(thread_text)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"""Analyze this procurement email thread and classify each email.

THREAD ({len(emails)} emails):
{thread_summary}

Return ONLY a JSON array, one object per email in order:
[
  {{
    "message_id": "exact message ID from [ID:...] tag",
    "step": 0-3,
    "confidence": 0.0-1.0,
    "reason": "brief reason in English",
    "signal_type": "advances" | "holds" | "neutral",
    "signal_confidence": 0.0-1.0,
    "part_numbers": ["list", "of", "parts"] or [],
    "supplier_name": "supplier company name or null",
    "is_significant": true/false,
    "significance_confidence": 0.0-1.0
  }}
]

Be strict with confidence: 0.9+ only if very clear, 0.7 if reasonably sure, below 0.5 if uncertain.
Be especially strict with signal_confidence — a wrong "advances" call is more costly than a
wrong step call, since it flips the step's status and stays flipped until corrected."""}
    ]

    logger.info("[BOOST] Verifying thread %d with %d emails", thread_id, len(emails))
    result = chat_json(messages, temperature=0.1)

    if not result or not isinstance(result, list):
        logger.warning("[BOOST] Invalid response for thread %d", thread_id)
        return None

    # Validate/clamp each entry — same defensive pattern as pipeline.py's
    # classify_step_llm, since this is the same class of "trust but verify"
    # LLM output.
    for entry in result:
        step = entry.get("step", 0)
        if not isinstance(step, int) or step < 0 or step > 3:
            entry["step"] = 0
        signal_type = entry.get("signal_type", "neutral")
        if signal_type not in ("advances", "holds", "neutral"):
            entry["signal_type"] = "neutral"
        if entry.get("step") == 0:
            entry["signal_type"] = "neutral"  # PR never participates, enforced here too

    logger.info("[BOOST] Thread %d verified: %d classifications", thread_id, len(result))
    return result


async def verify_single_email(email: Dict) -> Optional[Dict]:
    """Verify a single email (for quick checks).

    `email` should include a "sender_role" key — see verify_thread's docstring.
    """
    if not is_configured():
        return None

    sender = email.get("sender_email", "unknown")
    sender_role = email.get("sender_role", "unknown")
    subject = email.get("subject", "(no subject)")
    body = (email.get("body_text") or "")[:600].strip()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"""Classify this procurement email:

From: {sender}
SenderRole: {sender_role}
Subject: {subject}
Body: {body}

Return ONLY JSON:
{{
  "step": 0-3,
  "confidence": 0.0-1.0,
  "reason": "brief reason",
  "signal_type": "advances" | "holds" | "neutral",
  "signal_confidence": 0.0-1.0,
  "part_numbers": [] or ["part1", "part2"],
  "supplier_name": "company or null",
  "is_significant": true/false,
  "significance_confidence": 0.0-1.0
}}"""}
    ]

    result = chat_json(messages, temperature=0.1)
    if not result:
        return None

    step = result.get("step", 0)
    if not isinstance(step, int) or step < 0 or step > 3:
        result["step"] = 0
    signal_type = result.get("signal_type", "neutral")
    if signal_type not in ("advances", "holds", "neutral"):
        result["signal_type"] = "neutral"
    if result.get("step") == 0:
        result["signal_type"] = "neutral"

    return result
