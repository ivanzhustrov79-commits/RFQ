"""RFQ Flow NLP - Classify email to workflow step (1-7)."""
import re
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Workflow steps
STEP_NAMES = {
    1: "RFQ Sent",
    2: "Quote Received",
    3: "PI Received",
    4: "CI Issued",
    5: "Customs",
    6: "Delivered",
    7: "Closed",
}

# Keyword scoring for each step
# Format: {step: [(keyword, score), ...]}
STEP_KEYWORDS = {
    1: [
        # RFQ Sent (outgoing request)
        ('rfq', 3), ('request for quote', 3), ('request quotation', 3),
        ('запрос', 2), ('заявка', 2), ('прошу кп', 3), ('прошу цену', 3),
        ('询价', 2), ('請報價', 2),
        ('need price', 2), ('please quote', 3), ('send quote', 2),
    ],
    2: [
        # Quote Received (incoming quote with prices)
        ('quote', 3), ('quotation', 3), ('price', 2), ('pricing', 2),
        ('offer', 2), ('просим поставить', 2), ('цена', 2), ('стоимость', 2),
        ('предложение', 2), ('usd', 1), ('eur', 1), ('$', 1),
        ('attached quotation', 3), ('attached quote', 3),
        ('best price', 2), ('unit price', 2),
    ],
    3: [
        # PI Received (proforma invoice)
        ('proforma', 4), ('pi', 2), ('invoice', 2),
        ('проформа', 3), ('инвойс', 2), ('счет', 2),
        ('payment', 2), ('bank details', 3), ('swift', 2),
        ('wire transfer', 2), ('advance payment', 2),
    ],
    4: [
        # CI Issued (commercial invoice, shipping)
        ('commercial invoice', 4), ('ci', 2),
        ('shipping', 3), ('delivery', 2), ('shipment', 3),
        ('awb', 3), ('b/l', 3), ('bill of lading', 4),
        ('tracking', 2), ('courier', 2), ('express', 1),
        ('отгрузка', 3), ('доставка', 2), ('перевозка', 2),
    ],
    5: [
        # Customs
        ('customs', 4), ('custom declaration', 4), ('duties', 3),
        ('tariff', 2), ('hs code', 3), ('clearance', 3),
        ('таможня', 4), ('таможенн', 3), ('растаможка', 3),
        ('import permit', 3), ('certification', 2),
    ],
    6: [
        # Delivered
        ('delivered', 4), ('received', 3), ('arrived', 3),
        ('warehouse', 2), ('stock', 1), ('inventory', 1),
        ('доставлено', 4), ('получено', 3), ('прибыло', 3),
        ('goods received', 3), ('grn', 2),
    ],
    7: [
        # Closed
        ('closed', 4), ('completed', 3), ('finished', 3),
        ('thank you', 1), ('thanks', 1), ('done', 2),
        ('завершено', 3), ('закрыто', 3),
    ],
}

# Attachment indicators boost certain steps
ATTACHMENT_BOOST = {
    2: 2,  # Quote often has PDF attachment
    3: 2,  # PI often has PDF
    4: 1,  # CI/shipping docs
}

# Reply patterns (being a reply affects classification)
REPLY_INDICATORS = [
    ('re:', 1),
    ('fwd:', -1),
]


def classify_email(subject: str, body_text: str,
                   has_attachments: bool = False,
                   previous_emails: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """
    Classify email to workflow step.
    Returns dict matching models.StepClassification structure.
    """
    text = (subject + ' ' + body_text).lower()
    scores = {step: 0.0 for step in range(1, 8)}

    # Score based on keywords
    for step, keywords in STEP_KEYWORDS.items():
        for keyword, score in keywords:
            count = text.count(keyword.lower())
            if count > 0:
                scores[step] += score * min(count, 3)  # Cap at 3 occurrences

    # Boost for attachments
    if has_attachments:
        for step, boost in ATTACHMENT_BOOST.items():
            scores[step] += boost

    # Context from previous emails in thread
    if previous_emails:
        for prev in previous_emails[-3:]:  # Look at last 3
            prev_step = prev.get('step', 0)
            if 1 <= prev_step < 7:
                # Emails tend to progress forward in workflow
                scores[prev_step + 1] += 1.5

    # Find best step
    best_step = max(scores, key=scores.get)
    best_score = scores[best_step]
    total_score = sum(scores.values())

    # Calculate confidence
    if total_score == 0:
        confidence = 0.2
    else:
        confidence = min(0.95, 0.3 + (best_score / total_score) * 0.7)

    # Build alternatives
    alternatives = []
    for step, score in sorted(scores.items(), key=lambda x: x[1], reverse=True):
        if step != best_step and score > 0:
            alt_conf = score / total_score if total_score > 0 else 0
            alternatives.append({'step': step, 'confidence': round(alt_conf, 2)})

    # Low confidence check
    is_low_confidence = confidence < 0.5 or best_score < 2

    # Conflict check (two steps with similar scores)
    sorted_scores = sorted(scores.values(), reverse=True)
    has_conflict = len(sorted_scores) >= 2 and sorted_scores[0] - sorted_scores[1] < 1.5

    return {
        'suggested_step': best_step,
        'step_name': STEP_NAMES.get(best_step, 'Unknown'),
        'confidence': round(confidence, 2),
        'reason': f'Matched keywords for step {best_step}: {STEP_NAMES[best_step]}',
        'alternative_steps': alternatives[:3],
        'is_low_confidence': is_low_confidence,
        'has_conflict': has_conflict,
    }


def get_step_name(step: int) -> str:
    """Get human-readable name for a workflow step."""
    return STEP_NAMES.get(step, f'Step {step}')
