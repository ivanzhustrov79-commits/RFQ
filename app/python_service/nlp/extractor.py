"""RFQ Flow NLP - Extract RFQ data from email body."""
import re
import logging
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

# Part number patterns (cross-language)
PART_PATTERNS = [
    # OEM format: CAT-12345, 504130994, 5802703202
    re.compile(r'\b(\d{6,12}[A-Z]?)\b'),
    # Alphanumeric: CAT-12345, ABC123, 123-4567
    re.compile(r'\b([A-Z]{1,4}[-]?\d{4,10}[A-Z0-9]*)\b'),
    # Dash-separated: 123-4567, ABC-DEF-123
    re.compile(r'\b([A-Z]{2,4}-\d{3,8}(-[A-Z0-9]+)?)\b'),
]

# Price patterns
PRICE_PATTERNS = [
    re.compile(r'([\d.,]+)\s*(USD|EUR|usd|eur|\$|€)'),
    re.compile(r'(?:USD|EUR|\$|€)\s*([\d.,]+)'),
]

# Quantity patterns
QTY_PATTERNS = [
    re.compile(r'(?:qty|quantity|кол|кол-во|pcs|шт)[.:;\s]*([\d.,]+)', re.IGNORECASE),
    re.compile(r'\b(\d{1,4})\s*(?:pcs|шт|pieces|units|ea\.?|each)\b', re.IGNORECASE),
]

# Supplier name indicators in body
SUPPLIER_KEYWORDS = [
    ' ltd', ' limited', ' inc', ' corp', ' corporation', ' gmbh', ' sarl', ' s.a.', ' s.r.l.',
    ' llc', ' co.', ' company', ' group', ' holding', ' technologies', ' trading',
    ' ооо', ' зао', ' ао', ' ип ', ' техно', ' групп', ' компани',
]

# Known supplier domains for name inference
KNOWN_SUPPLIERS = {
    'snabavto.com': 'SNABAVTO',
    'turbosystems.ru': 'TurboSystems',
    'agro-pro2014.ru': 'Agro-Pro',
}


def extract_rfq_data(subject: str, body_text: str, sender_domain: str,
                     body_language: Optional[str] = None) -> Dict[str, Any]:
    """
    Extract RFQ-relevant data from email.
    Returns dict matching models.RfqExtracted structure.
    """
    # 1. Extract supplier name
    supplier_name, supplier_confidence = extract_supplier_name(
        body_text, sender_domain, subject
    )

    # 2. Extract part numbers
    parts = extract_part_numbers(body_text, subject)

    # 3. Generate RFQ name
    rfq_name = generate_rfq_name(subject, parts, supplier_name)

    # 4. Detect language (if not provided)
    detected_language = body_language or detect_language_quick(body_text)

    return {
        'supplier_name': supplier_name,
        'supplier_name_confidence': supplier_confidence,
        'part_numbers': [p.model_dump() if hasattr(p, 'model_dump') else p for p in parts],
        'rfq_name': rfq_name,
        'rfq_name_source': 'auto',
        'ci_number': None,
        'detected_language': detected_language,
        'translation': None,
    }


def extract_supplier_name(body_text: str, sender_domain: str,
                          subject: str) -> tuple:
    """
    Extract supplier name from email.
    Strategy:
    1. Check known supplier domains
    2. Look for company indicators in body text
    3. Fall back to domain-based name
    """
    # 1. Known domain lookup
    domain_lower = sender_domain.lower()
    if domain_lower in KNOWN_SUPPLIERS:
        return KNOWN_SUPPLIERS[domain_lower], 0.95

    # 2. Body text company detection
    lines = body_text.split('\n')[:30]
    for line in lines:
        line_lower = line.lower()
        for keyword in SUPPLIER_KEYWORDS:
            if keyword in line_lower:
                idx = line_lower.find(keyword)
                end = idx + len(keyword)
                # Walk backwards to find start of phrase (word boundary or punctuation)
                start = idx
                while start > 0 and line[start - 1] not in '.,;:!?\n\r' and (idx - start) < 40:
                    start -= 1
                candidate = line[start:end].strip()
                # Clean up
                candidate = re.sub(r'^(From|To|Cc|От|Кому|Email|Tel|Fax|Price)[:\s]*', '', candidate, flags=re.IGNORECASE)
                candidate = re.sub(r'^[^A-Za-zА-Яа-я0-9]*', '', candidate)
                if len(candidate) > 3 and len(candidate) < 60:
                    return candidate, 0.7

    # 3. Signature block detection (bottom of email)
    sig_lines = body_text.strip().split('\n')[-10:]
    for line in sig_lines:
        line = line.strip()
        if any(kw in line.lower() for kw in SUPPLIER_KEYWORDS):
            if len(line) > 3 and len(line) < 80 and '@' not in line:
                return line, 0.6

    # 4. Fall back to domain capitalized
    domain_name = sender_domain.split('.')[0].upper()
    return domain_name, 0.3


def extract_part_numbers(body_text: str, subject: str) -> List[Any]:
    """Extract part numbers from body and subject."""
    from models import PartNumberExtracted

    parts: List[PartNumberExtracted] = []
    found_numbers: set = set()

    # Search in subject + body
    search_text = subject + '\n' + body_text

    for pattern in PART_PATTERNS:
        for match in pattern.finditer(search_text):
            pn = match.group(1).strip().upper()
            # Filter out common false positives
            if is_valid_part_number(pn) and pn not in found_numbers:
                found_numbers.add(pn)

                # Try to find quantity near the part number
                qty, qty_conf = extract_quantity(search_text, match.start())

                # Try to find price
                price, price_conf = extract_price(search_text, match.start())

                parts.append(PartNumberExtracted(
                    part_number=pn,
                    description=None,
                    quantity=qty,
                    quantity_confidence=qty_conf,
                    currency='USD' if price else None,
                    unit_price=price,
                    price_confidence=price_conf,
                ))

    return parts[:20]  # Limit to 20 parts per email


def is_valid_part_number(pn: str) -> bool:
    """Filter out false positives like years, phone numbers."""
    if len(pn) < 4 or len(pn) > 25:
        return False
    # Skip pure years
    if re.match(r'^20\d{2}$', pn):
        return False
    # Skip phone-looking numbers
    if re.match(r'^\d{3}[-.]?\d{3}[-.]?\d{4}$', pn):
        return False
    # Must have at least one digit
    if not any(c.isdigit() for c in pn):
        return False
    # Skip common words
    skip_words = {'HTTP', 'HTML', 'WWW', 'COM', 'ORG', 'NET', 'EMAIL', 'TEL', 'FAX'}
    if pn in skip_words:
        return False
    return True


def extract_quantity(text: str, position: int) -> tuple:
    """Find quantity near a given position in text."""
    # Look in a window around the position
    window_start = max(0, position - 200)
    window_end = min(len(text), position + 200)
    window = text[window_start:window_end]

    for pattern in QTY_PATTERNS:
        match = pattern.search(window)
        if match:
            try:
                qty = int(float(match.group(1).replace(',', '.')))
                if 1 <= qty <= 10000:
                    return qty, 0.8
            except ValueError:
                pass
    return None, 0.0


def extract_price(text: str, position: int) -> tuple:
    """Find price near a given position in text."""
    window_start = max(0, position - 300)
    window_end = min(len(text), position + 300)
    window = text[window_start:window_end]

    for pattern in PRICE_PATTERNS:
        match = pattern.search(window)
        if match:
            try:
                price = float(match.group(1).replace(',', ''))
                if 0.01 <= price <= 1000000:
                    return price, 0.75
            except ValueError:
                pass
    return None, 0.0


def generate_rfq_name(subject: str, parts: List[Any],
                      supplier_name: Optional[str]) -> Optional[str]:
    """Generate a descriptive RFQ name."""
    if not parts:
        # No parts found, use subject if it looks like an RFQ
        if any(kw in subject.upper() for kw in ['RFQ', 'QUOTE', 'ЗАПРОС', 'КП', 'OFFER', 'PRICE']):
            return clean_subject(subject)
        return None

    # Build name from supplier + first part number
    name_parts = []
    if supplier_name:
        name_parts.append(supplier_name.split()[0] if ' ' in supplier_name else supplier_name)
    name_parts.append(parts[0].part_number)

    return 'RFQ - ' + ' '.join(name_parts)


def clean_subject(subject: str) -> str:
    """Clean email subject for use as RFQ name."""
    # Remove Re:, Fwd: prefixes
    cleaned = re.sub(r'^(Re:|Fwd:|FW:|RE:|FWD:)\s*', '', subject, flags=re.IGNORECASE)
    return cleaned.strip()[:100]


def detect_language_quick(text: str) -> Optional[str]:
    """Quick language detection without external libraries."""
    if not text:
        return None
    sample = text[:2000]

    # Cyrillic
    if re.search(r'[\u0400-\u04FF]', sample):
        return "ru"
    # Chinese
    if re.search(r'[\u4E00-\u9FFF]', sample):
        return "zh"
    # Arabic
    if re.search(r'[\u0600-\u06FF]', sample):
        return "ar"
    # Latin script
    if re.search(r'[a-zA-Z]', sample):
        return "en"

    return None
