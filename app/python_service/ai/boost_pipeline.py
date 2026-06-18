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

Workflow steps:
0: Purchase Request - initial inquiry (internal trigger, OR our first ask to supplier).
   Not every early email is RFQ-related — some are just informational, no real connection
   to a price request.
1: RFQ Sent - buyer sent supplier a detailed request for prices on a specific part list
2: RFQ Received - supplier's price/availability answer for parts not previously quoted,
   including follow-up batches of NEW pricing (parts the supplier hadn't priced yet).
3: Negotiation - discussion SPECIFICALLY about prices/availability/quantity/substitutes
   that were ALREADY quoted in step 2. New parts/prices never mentioned before = step 2,
   not step 3 — step 3 requires an existing quote being discussed.
4: Invoice - supplier sends invoice or proforma invoice (PI), including revisions
5: CI Approved - buyer confirms acceptance of prices for a specific part list (the final
   list usually differs from the original request; if multiple confirmations exist, the
   LATEST reflects the true final list)

You understand Russian, English, and Chinese procurement terminology.
Russian keywords: расценка=quote, инвойс=invoice, оплата=payment, отгрузка=shipment, 
платеж=payment, проформа=proforma, доставка=delivery, SWIFT=payment confirmation

You also assess SIGNIFICANCE: is_significant=true means the email substantively advances
the business (actual prices, part lists, decisions, confirmations). is_significant=false
means small talk, greetings, "will check later" with no real content, or internal chatter
that doesn't matter for tracking the deal. This is a SEPARATE judgment from step assignment —
an email can be confidently step-classified yet still be insignificant noise within that step."""


async def verify_thread(thread_id: int, emails: List[Dict]) -> Optional[List[Dict]]:
    """
    Send full thread to BOOST API for verification.
    Returns list of {message_id, step, confidence, parts, supplier_name} or None.
    """
    if not is_configured():
        return None

    if not emails:
        return None

    # Build thread summary for API
    thread_text = []
    for i, e in enumerate(emails):
        sender = e.get("sender_email", "unknown")
        subject = e.get("subject", "(no subject)")
        # Truncate body to save tokens
        body = (e.get("body_text") or "")[:400].strip()
        current_step = e.get("step_assigned", 0)
        thread_text.append(
            f"Email {i+1} [ID:{e.get('message_id','?')}] [CurrentStep:{current_step}]\n"
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
    "step": 0-5,
    "confidence": 0.0-1.0,
    "reason": "brief reason in English",
    "part_numbers": ["list", "of", "parts"] or [],
    "supplier_name": "supplier company name or null",
    "is_significant": true/false,
    "significance_confidence": 0.0-1.0
  }}
]

Be strict with confidence: 0.9+ only if very clear, 0.7 if reasonably sure, below 0.5 if uncertain."""}
    ]

    logger.info("[BOOST] Verifying thread %d with %d emails", thread_id, len(emails))
    result = chat_json(messages, temperature=0.1)

    if not result or not isinstance(result, list):
        logger.warning("[BOOST] Invalid response for thread %d", thread_id)
        return None

    logger.info("[BOOST] Thread %d verified: %d classifications", thread_id, len(result))
    return result


async def verify_single_email(email: Dict) -> Optional[Dict]:
    """Verify a single email (for quick checks)."""
    if not is_configured():
        return None

    sender = email.get("sender_email", "unknown")
    subject = email.get("subject", "(no subject)")
    body = (email.get("body_text") or "")[:600].strip()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"""Classify this procurement email:

From: {sender}
Subject: {subject}
Body: {body}

Return ONLY JSON:
{{
  "step": 0-5,
  "confidence": 0.0-1.0,
  "reason": "brief reason",
  "part_numbers": [] or ["part1", "part2"],
  "supplier_name": "company or null",
  "is_significant": true/false,
  "significance_confidence": 0.0-1.0
}}"""}
    ]

    return chat_json(messages, temperature=0.1)
