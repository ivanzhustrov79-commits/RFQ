"""RFQ Flow AI - LLM Pipeline (Phase 5)

Provides LLM-powered NLP with automatic fallback to Phase 4 heuristics
when Ollama is unavailable or the LLM request fails.
"""
import logging
from typing import Optional, Dict, Any, List

from ai.ollama_client import is_available, generate_json
from nlp.extractor import extract_rfq_data as heuristic_extract
from nlp.classifier import classify_email as heuristic_classify
from models import RfqExtracted, PartNumberExtracted, StepClassification, StepAlternative

logger = logging.getLogger(__name__)


def extract_rfq_llm(subject: str, body_text: str, sender_domain: str,
                    body_language: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Use LLM to extract RFQ data. Returns None if Ollama unavailable.
    """
    if not is_available():
        return None

    # Truncate body to keep prompt reasonable
    body_truncated = body_text[:3000] if body_text else ""

    prompt = f"""You are an RFQ (Request for Quote) data extraction assistant.
Analyze this email and extract structured data.

Email Subject: {subject}
Sender Domain: {sender_domain}
Body:
{body_truncated}

Extract and return ONLY a JSON object with this exact structure:
{{
  "supplier_name": "company name or null",
  "supplier_name_confidence": 0.0 to 1.0,
  "part_numbers": [
    {{
      "part_number": "the part number",
      "description": "brief description or null",
      "quantity": integer or null,
      "currency": "USD/EUR/null",
      "unit_price": float or null
    }}
  ],
  "rfq_name": "descriptive RFQ name or null",
  "ci_number": "commercial invoice number or null",
  "detected_language": "en/ru/zh/etc"
}}

Rules:
- Part numbers are typically 6-12 digit codes or alphanumeric codes like CAT-12345
- Supplier name is the company sending the quote, not the recipient
- Confidence should reflect certainty (0.9 = very sure, 0.3 = guess)
- If no part numbers found, return empty array
- RFQ name should be concise: "Supplier - PartNumber" or similar"""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        return None

    # Normalize to our model structure
    parts = []
    for p in result.get("part_numbers", []):
        parts.append({
            "part_number": str(p.get("part_number", "")),
            "description": p.get("description"),
            "quantity": p.get("quantity"),
            "quantity_confidence": 0.9 if p.get("quantity") else 0.0,
            "currency": p.get("currency", "USD") if p.get("unit_price") else None,
            "unit_price": float(p["unit_price"]) if p.get("unit_price") else None,
            "price_confidence": 0.9 if p.get("unit_price") else 0.0,
        })

    return {
        "supplier_name": result.get("supplier_name"),
        "supplier_name_confidence": result.get("supplier_name_confidence", 0.5),
        "part_numbers": parts,
        "rfq_name": result.get("rfq_name"),
        "rfq_name_source": "llm",
        "ci_number": result.get("ci_number"),
        "detected_language": result.get("detected_language", body_language),
        "translation": None,
    }


def classify_step_llm(subject: str, body_text: str,
                      has_attachments: bool = False,
                      previous_emails: Optional[List[Dict]] = None) -> Optional[Dict[str, Any]]:
    """
    Use LLM to classify email to workflow step. Returns None if Ollama unavailable.
    """
    if not is_available():
        return None

    body_truncated = body_text[:3000] if body_text else ""

    prev_context = ""
    if previous_emails:
        for i, prev in enumerate(previous_emails[-3:]):
            prev_context += f"\nPrevious email {i+1}: step {prev.get('step', '?')} - {prev.get('subject', 'N/A')}"

    prompt = f"""You are an RFQ workflow classifier. Classify this email into one of 7 steps.

Workflow Steps:
1. RFQ Sent - Outgoing request for quote
2. Quote Received - Incoming price quotation from supplier
3. PI Received - Proforma invoice received
4. CI Issued - Commercial invoice/shipping documents
5. Customs - Customs clearance/declaration
6. Delivered - Goods received at warehouse
7. Closed - Order completed

Email Subject: {subject}
Has Attachments: {has_attachments}
{prev_context}

Body:
{body_truncated}

Return ONLY a JSON object:
{{
  "suggested_step": 1-7,
  "step_name": "human readable name",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation",
  "is_low_confidence": true/false,
  "has_conflict": true/false
}}"""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        return None

    step = result.get("suggested_step", 1)
    if not isinstance(step, int) or step < 1 or step > 7:
        step = 1

    return {
        "suggested_step": step,
        "step_name": result.get("step_name", f"Step {step}"),
        "confidence": result.get("confidence", 0.5),
        "reason": result.get("reason", "LLM classification"),
        "alternative_steps": [],
        "is_low_confidence": result.get("is_low_confidence", False),
        "has_conflict": result.get("has_conflict", False),
    }


def extract_rfq(subject: str, body_text: str, sender_domain: str,
                body_language: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract RFQ data: tries LLM first, falls back to heuristics.
    """
    # Try LLM first (Phase 5)
    llm_result = extract_rfq_llm(subject, body_text, sender_domain, body_language)
    if llm_result:
        logger.info("[AI] LLM extract succeeded: supplier=%s, parts=%d",
                   llm_result.get("supplier_name"),
                   len(llm_result.get("part_numbers", [])))
        return llm_result

    # Fallback to heuristics (Phase 4)
    logger.debug("[AI] LLM unavailable, using heuristic extraction")
    return heuristic_extract(subject, body_text, sender_domain, body_language)


def classify_step(subject: str, body_text: str,
                  has_attachments: bool = False,
                  previous_emails: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """
    Classify workflow step: tries LLM first, falls back to heuristics.
    """
    # Try LLM first (Phase 5)
    llm_result = classify_step_llm(subject, body_text, has_attachments, previous_emails)
    if llm_result:
        logger.info("[AI] LLM classify succeeded: step=%d %s (conf=%.2f)",
                   llm_result["suggested_step"],
                   llm_result["step_name"],
                   llm_result["confidence"])
        return llm_result

    # Fallback to heuristics (Phase 4)
    logger.debug("[AI] LLM unavailable, using heuristic classification")
    return heuristic_classify(subject, body_text, has_attachments, previous_emails)
