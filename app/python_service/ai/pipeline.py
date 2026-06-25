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

    prompt = f"""You are a procurement data extraction assistant for agricultural machinery parts.
Extract structured data from this email. Emails may be in Russian, English, or Chinese.

Email Subject: {subject}
Sender Domain: {sender_domain}
Body:
{body_truncated}

Extract and return ONLY a JSON object in this exact format. If a value is unknown, use the
JSON literal null (not the word "null" as text, and not a placeholder description):

Example of correct output:
{{
  "supplier_name": "Ningbo Combine Machinery Co Ltd",
  "supplier_name_confidence": 0.9,
  "part_numbers": [
    {{"part_number": "84388386", "description": "Sprocket", "quantity": 10, "currency": "USD", "unit_price": 12.5}}
  ],
  "rfq_name": "Combine - Sprocket Order",
  "ci_number": "25COM8859M",
  "detected_language": "en"
}}

Required JSON schema:
{{
  "supplier_name": <string company name, or JSON null if genuinely unknown>,
  "supplier_name_confidence": <float 0.0-1.0>,
  "part_numbers": [
    {{
      "part_number": <string>,
      "description": <string or JSON null>,
      "quantity": <integer or JSON null>,
      "currency": <"USD"|"EUR"|"CNY" or JSON null>,
      "unit_price": <float or JSON null>
    }}
  ],
  "rfq_name": <string or JSON null>,
  "ci_number": <string or JSON null>,
  "detected_language": <"en"|"ru"|"zh"|"tr">
}}

Rules:
- Part numbers: alphanumeric codes, typically 6-15 characters, often containing digits
  mixed with letters/hyphens (manufacturer part numbers, catalog numbers). Only extract
  codes that ACTUALLY APPEAR in the email text below — never invent or use a placeholder.
- Look for Russian: артикул, каталожный номер, номер детали
- Supplier is the company in the email domain, not the recipient
- If no part numbers found, return empty array
- RFQ name: "Supplier - Product" format, 3-6 words
- NEVER write the literal text "company name or null" or any placeholder text — use a real value or JSON null
- NEVER invent example-looking codes (such as generic placeholder-style part numbers) —
  only return codes you can verify appear verbatim in the email body above"""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        return None

    # Sanitize: reject placeholder/instruction text the model may echo back verbatim
    PLACEHOLDER_PATTERNS = (
        "company name or null", "company name", "string or null", "or null",
        "unknown", "n/a", "none", "null",
    )

    def clean_field(value):
        if isinstance(value, str) and value.strip().lower() in PLACEHOLDER_PATTERNS:
            return None
        return value

    supplier_name = clean_field(result.get("supplier_name"))
    rfq_name = clean_field(result.get("rfq_name"))
    ci_number = clean_field(result.get("ci_number"))

    # Normalize to our model structure. Also verify each part number actually appears
    # verbatim in the source email — this catches qwen hallucinating example-looking
    # codes (like the literal "CAT-12345" that used to be in our own prompt as an
    # illustration) regardless of WHY it hallucinated, not just that one specific string.
    KNOWN_PROMPT_LEAK_VALUES = {"cat-12345", "84388386", "4c3115", "h931870040070"}
    source_text_lower = (body_text or "").lower()

    parts = []
    for p in result.get("part_numbers", []):
        part_num = str(p.get("part_number", "")).strip()
        if not part_num:
            continue
        part_num_lower = part_num.lower()
        if part_num_lower in KNOWN_PROMPT_LEAK_VALUES:
            continue  # exact known leak, always reject
        if part_num_lower not in source_text_lower:
            continue  # not verbatim in source — likely hallucinated, skip silently
        parts.append({
            "part_number": part_num,
            "description": clean_field(p.get("description")),
            "quantity": p.get("quantity"),
            "quantity_confidence": 0.9 if p.get("quantity") else 0.0,
            "currency": p.get("currency", "USD") if p.get("unit_price") else None,
            "unit_price": float(p["unit_price"]) if p.get("unit_price") else None,
            "price_confidence": 0.9 if p.get("unit_price") else 0.0,
        })

    return {
        "supplier_name": supplier_name,
        "supplier_name_confidence": result.get("supplier_name_confidence", 0.5) if supplier_name else 0.0,
        "part_numbers": parts,
        "rfq_name": rfq_name,
        "rfq_name_source": "llm",
        "ci_number": ci_number,
        "detected_language": result.get("detected_language", body_language),
        "translation": None,
    }


# Stricter than the general 0.6 step-confidence review bar, per design: a
# wrong "advances"/"holds" call is more costly than a wrong step call, since
# it flips a whole step's color and stays flipped (by the redesign's sticky-
# green rule) until something explicitly corrects it.
SIGNAL_REVIEW_THRESHOLD = 0.75


def classify_step_llm(subject: str, body_text: str,
                      sender_role: str = "unknown",
                      has_attachments: bool = False,
                      previous_emails: Optional[List[Dict]] = None,
                      learned_rules_hint: str = "") -> Optional[Dict[str, Any]]:
    """
    Use LLM to classify email to workflow step (new 4-step taxonomy: PR/RFQ/
    CI/Downpayment), plus signal_type (advances/holds/neutral) for the
    Kanban card color logic.

    sender_role: "boss" | "user" | "supplier" | "unknown" — who actually
    sent THIS email. Required for signal_type to be judged correctly, since
    the step definitions are explicitly directional (e.g. RFQ's "advances"
    is the supplier confirming, not you sending) — this is a data fact the
    LLM has no way to infer from content alone, so it's passed in rather
    than guessed. Computed by the caller via database.determine_sender_role.

    Returns None if Ollama unavailable.
    learned_rules_hint: optional text block of active learned rules (from BOOST corrections)
    to inject into the prompt, making local classification smarter over time.
    """
    if not is_available():
        return None

    body_truncated = body_text[:3000] if body_text else ""

    prev_context = ""
    if previous_emails:
        for i, prev in enumerate(previous_emails[-3:]):
            prev_context += f"\nPrevious email {i+1}: step {prev.get('step', '?')} - {prev.get('subject', 'N/A')}"

    prompt = f"""You are an RFQ workflow classifier for agricultural machinery parts procurement.
Classify this email into one of 4 steps. The emails are from Russian/Chinese/Turkish suppliers.

Workflow Steps:
0: PR (Purchase Request) — INTERNAL ONLY, never supplier-facing. Your boss
   asking you to source something, or you confirming you'll handle it. If
   this email involves a supplier at all (sender_role=supplier, or clearly
   addressed to one), it is NOT step 0 — use step 1 (RFQ) instead.
1: RFQ — covers both sending a supplier a request for quotation AND
   receiving their price/availability answer. One merged step for the
   whole "ask and get quoted" phase (old separate "RFQ Sent"/"RFQ Received"
   steps no longer exist — both are step 1 now).
2: CI — covers price negotiation, invoice/PI exchange, and final
   confirmation/approval of the deal. One merged step for the whole "agree
   on the deal" phase (old "Negotiation"/"Invoice"/"CI Approved" steps no
   longer exist — all three are step 2 now).
3: Downpayment — anything specifically about prepayment/advance payment/
   deposit for this order: confirming it was sent, asking about it, or
   confirming receipt.

Sender role for THIS email: {sender_role}
  ("user" = you sent this; "supplier" = the supplier sent this;
   "boss" = your boss sent this; "unknown" = direction unclear)

Russian keywords guide:
- Step 0: запрос, расценка, запросить, КП (коммерческое предложение) — only when NOT supplier-facing
- Step 1: прайс, цена, предложение, проформа, PF, котировка
- Step 2: переговоры, согласование, инвойс, CI, счет, отгрузка, B/L, коносамент
- Step 3: предоплата, аванс, авансовый платеж
{learned_rules_hint}

Email Subject: {subject}
Has Attachments: {has_attachments}
{prev_context}

Body:
{body_truncated}

In addition to the step, determine this email's SIGNAL relative to that
step — whether it represents the step's defining success condition, an
explicit hold/cancellation, or neither. This drives a colored status card,
so be conservative: only mark "advances" when the condition is clearly met.

  - Step 1 (RFQ) "advances": the SUPPLIER (sender_role=supplier) is
    confirming they received/are answering the RFQ. Your own outgoing
    request is "neutral" for this purpose, not "advances" — only the
    supplier's confirmation counts.
  - Step 2 (CI) "advances": YOU (sender_role=user) are sending the supplier
    approval/acceptance of their invoice, PI, or CI. The supplier SENDING
    the invoice is "neutral" here — only YOUR approval of it counts.
  - Step 3 (Downpayment) "advances": ANY of — you confirming to the supplier
    that prepayment was made; your boss messaging you about prepayment for
    this order; OR the supplier confirming they received the prepayment.
  - Step 0 (PR): signal_type is always "neutral" — PR has no success/hold
    tracking at all.
  - "holds" (steps 1-3 only): this email explicitly pauses, postpones, or
    cancels progress on this step — e.g. "let's hold off", "cancel this
    order", "we need to pause this".
  - "neutral": anything not meeting the above — most routine correspondence,
    including ordinary back-and-forth that doesn't itself represent the
    step's defining success condition.

Also determine: is this email SIGNIFICANT for this step, or is it NOISE? Significant means
it substantively advances the business (contains actual prices, part lists, decisions,
confirmations). Noise means small talk, greetings, "will check and reply later" with no
real content, or internal chatter that happens to be in this thread but doesn't matter
for tracking the deal.

Return ONLY a JSON object:
{{
  "suggested_step": 0-3,
  "step_name": "human readable name",
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation in English",
  "is_low_confidence": true/false,
  "has_conflict": false,
  "needs_review": true/false,
  "is_significant": true/false,
  "significance_confidence": 0.0 to 1.0,
  "signal_type": "advances" | "holds" | "neutral",
  "signal_confidence": 0.0 to 1.0
}}

Set needs_review=true if: the email content is genuinely ambiguous between two steps,
mixes multiple topics, or you are not confident which step applies.
Be especially strict with signal_confidence — a wrong "advances" call is more costly than
a wrong step call, since it flips the step's color and stays flipped until corrected."""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        return None

    step = result.get("suggested_step", 0)
    if not isinstance(step, int) or step < 0 or step > 3:
        step = 0

    confidence = result.get("confidence", 0.5)

    signal_type = result.get("signal_type", "neutral")
    if signal_type not in ("advances", "holds", "neutral"):
        signal_type = "neutral"
    signal_confidence = result.get("signal_confidence", 0.5)
    if not isinstance(signal_confidence, (int, float)):
        signal_confidence = 0.5
    if step == 0:
        # PR never participates in the color system — this is a hard rule
        # override, not a probabilistic judgment, so confidence is certain.
        signal_type = "neutral"
        signal_confidence = 1.0

    # Signal calls get a STRICTER review bar than step calls: a wrong
    # "advances"/"holds" is stickier and more consequential (flips a whole
    # column's color and stays flipped, by design, until corrected) than a
    # wrong step assignment, which is comparatively easy to fix later.
    needs_review = (
        result.get("needs_review", False)
        or confidence < 0.6
        or (signal_type in ("advances", "holds") and signal_confidence < SIGNAL_REVIEW_THRESHOLD)
    )

    return {
        "suggested_step": step,
        "step_name": result.get("step_name", f"Step {step}"),
        "confidence": confidence,
        "reason": result.get("reason", "LLM classification"),
        "alternative_steps": [],
        "is_low_confidence": result.get("is_low_confidence", False),
        "has_conflict": result.get("has_conflict", False),
        "needs_review": needs_review,
        "is_significant": result.get("is_significant", True),
        "significance_confidence": result.get("significance_confidence", 0.5),
        "signal_type": signal_type,
        "signal_confidence": signal_confidence,
    }


def suggest_thread_grouping(subject: str, body_text: str, sender_email: str,
                              existing_threads: List[Dict]) -> Optional[Dict[str, Any]]:
    """
    Ask qwen whether this email belongs to an existing thread (even with a different
    subject) or should start a new RFQ thread. Helps fix subject-prefix over-splitting.

    existing_threads: list of {id, subject_prefix, email_count} for this supplier.
    Returns: {action: 'join_existing'|'new_thread', thread_id: int|None, confidence, reason}
    """
    if not is_available() or not existing_threads:
        return None

    body_truncated = (body_text or "")[:1500]

    threads_list = "\n".join(
        f"  Thread {t['id']}: \"{t['subject_prefix']}\" ({t['email_count']} emails)"
        for t in existing_threads[:15]  # cap to keep prompt small
    )

    prompt = f"""You are analyzing procurement emails to determine if a new email continues
an existing business deal (RFQ) even if the subject line is different — for example,
an initial inquiry, a price quote, and a payment confirmation may have completely
different subjects but are the SAME real-world deal.

New email:
Subject: {subject}
From: {sender_email}
Body: {body_truncated}

Existing threads with this same supplier:
{threads_list}

Does this email continue one of the existing threads (different subject is OK if it's
clearly the same deal/conversation), or is it a genuinely NEW separate request?

Return ONLY a JSON object:
{{
  "action": "join_existing" or "new_thread",
  "thread_id": <id of matching thread, or null if new_thread>,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation"
}}"""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        return None

    action = result.get("action")
    if action not in ("join_existing", "new_thread"):
        return None

    return {
        "action": action,
        "thread_id": result.get("thread_id") if action == "join_existing" else None,
        "confidence": result.get("confidence", 0.5),
        "reason": result.get("reason", ""),
    }


def compare_threads_for_merge(thread_a_subject: str, thread_a_sample: str,
                                thread_b_subject: str, thread_b_sample: str) -> Optional[Dict[str, Any]]:
    """
    Ask qwen whether two existing threads (each represented by their opening email)
    are actually the SAME real-world business deal, just split by subject-prefix grouping.
    Used for retroactive thread merging (fixing already-fragmented RFQs).

    thread_a_sample / thread_b_sample: truncated body text of each thread's first email.
    Returns: {same_deal: bool, confidence: 0.0-1.0, reason: str}
    """
    if not is_available():
        return None

    prompt = f"""You are analyzing two separate email threads from the same supplier to determine
if they actually represent the SAME real-world procurement deal (RFQ), just split into
different threads because their subject lines differ — for example, an initial inquiry,
a price quote reply, and a payment/shipping confirmation about the same parts/order
are the SAME deal even with totally different subjects.

Thread A:
Subject: {thread_a_subject}
First email: {thread_a_sample[:1000]}

Thread B:
Subject: {thread_b_subject}
First email: {thread_b_sample[:1000]}

Are these the SAME business deal (same parts, same order, same conversation just
continued under a different subject), or are they genuinely DIFFERENT/unrelated requests?

Return ONLY a JSON object:
{{
  "same_deal": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation"
}}"""

    result = generate_json(prompt, temperature=0.1)
    if not result:
        logger.warning("[MERGE] compare_threads_for_merge got no result from generate_json "
                        "(A=%r vs B=%r)", thread_a_subject, thread_b_subject)
        return None

    logger.info("[MERGE] Compared %r vs %r -> same_deal=%s confidence=%.2f reason=%s",
                thread_a_subject, thread_b_subject,
                result.get("same_deal"), result.get("confidence", 0), result.get("reason", ""))

    return {
        "same_deal": bool(result.get("same_deal", False)),
        "confidence": result.get("confidence", 0.5),
        "reason": result.get("reason", ""),
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
                  sender_role: str = "unknown",
                  has_attachments: bool = False,
                  previous_emails: Optional[List[Dict]] = None,
                  learned_rules_hint: str = "") -> Dict[str, Any]:
    """
    Classify workflow step: tries LLM first, falls back to heuristics.
    learned_rules_hint: text block of active learned rules from BOOST teaching loop.
    sender_role: see classify_step_llm — "boss"|"user"|"supplier"|"unknown".
    """
    # Try LLM first (Phase 5)
    llm_result = classify_step_llm(subject, body_text, sender_role, has_attachments, previous_emails, learned_rules_hint)
    if llm_result:
        logger.info("[AI] LLM classify succeeded: step=%d %s (conf=%.2f)",
                   llm_result["suggested_step"],
                   llm_result["step_name"],
                   llm_result["confidence"])
        return llm_result

    # Fallback to heuristics (Phase 4) — the heuristic classifier doesn't
    # know about the new signal_type concept (it's a much simpler keyword/
    # regex fallback, not worth teaching this to for a degraded-mode path).
    # Default to "neutral" so downstream code always sees a consistent
    # shape regardless of which path produced the classification.
    logger.debug("[AI] LLM unavailable, using heuristic classification")
    result = heuristic_classify(subject, body_text, has_attachments, previous_emails)
    result.setdefault("signal_type", "neutral")
    return result
