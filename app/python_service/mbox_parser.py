"""RFQ Flow Python Service - MBOX File Parser"""
import logging
import re
from datetime import datetime, timezone
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parsedate_to_datetime, getaddresses
from email.header import decode_header, make_header
from pathlib import Path
from typing import Iterator, Optional, Tuple, List

from models import ParsedEmail, MboxParseOptions
from config import MAX_MBOX_SIZE_MB

logger = logging.getLogger(__name__)
INTERNAL_EMAILS = ["info@field-pro.ae", "vlebedinets@agro-pro2014.ru"]
USER_EMAIL = "izhustrov@import-detal36.ru"


class MboxTooLargeError(Exception):
    pass


def parse_mbox_file(mbox_path: str, max_emails: int = 100,
                    options: Optional[MboxParseOptions] = None):
    """Parse MBOX file, return (emails_list, total_count)."""
    if options is None:
        options = MboxParseOptions()

    path = Path(mbox_path)
    if not path.exists():
        raise FileNotFoundError(f"MBOX not found: {mbox_path}")

    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > MAX_MBOX_SIZE_MB:
        raise MboxTooLargeError(f"{size_mb:.1f}MB exceeds {MAX_MBOX_SIZE_MB}MB")

    emails = []
    total = 0
    idx = 0
    parser = BytesParser(policy=policy.default)

    for raw in _iter_messages(path):
        total += 1
        if len(emails) >= max_emails:
            break
        try:
            msg = parser.parsebytes(raw)
            email = _extract(msg, idx, options)
            if email:
                emails.append(email)
                idx += 1
        except Exception as e:
            logger.warning("Parse error msg %d: %s", idx, e)

    logger.info("Parsed %d/%d from %s", len(emails), total, path.name)
    return emails, total


def _iter_messages(path: Path) -> Iterator[bytes]:
    """Iterate messages in MBOX file (separated by 'From ' lines)."""
    with open(path, "rb") as f:
        buf = []
        for line in f:
            if line.startswith(b"From ") and len(line) > 5:
                if buf:
                    yield b"".join(buf)
                    buf = []
                continue
            if line.startswith(b">From "):
                line = line[1:]
            buf.append(line)
        if buf:
            yield b"".join(buf)


def _extract(msg: EmailMessage, idx: int, opt: MboxParseOptions) -> Optional[ParsedEmail]:
    """Extract fields from parsed email."""
    mid = msg.get("Message-ID", "") or f"<gen-{idx}@rfq>"
    from_hdr = msg.get("From", "")
    if not from_hdr:
        return None

    sender_email, sender_name = _parse_addr(from_hdr)
    if not sender_email:
        sender_email = from_hdr.strip()
    sender_domain = sender_email.split("@")[-1] if "@" in sender_email else ""
    subject = _decode(msg.get("Subject", "(no subject)"))
    sent_at = _parse_dt(msg.get("Date", ""))

    body_text = body_html = None
    attachments: List[str] = []

    if opt.parse_body:
        body_text, body_html, attachments = _body(msg)

    irt = msg.get("In-Reply-To", "")
    refs = msg.get("References", "").split() if msg.get("References") else []
    thread_id = irt.strip("<>") if irt else (refs[0].strip("<>") if refs else None)

    is_int = any(e.lower() in sender_email.lower() for e in INTERNAL_EMAILS)
    is_sent = USER_EMAIL.lower() in sender_email.lower()

    lang = None
    if opt.detect_language and body_text:
        lang = _lang(body_text)

    return ParsedEmail(
        id=1000 + idx, message_id=mid.strip(), subject=subject,
        sender_email=sender_email, sender_name=sender_name or sender_email.split("@")[0],
        sender_domain=sender_domain, sent_at=sent_at,
        body_text=body_text, body_html=body_html, body_language=lang,
        thread_id=thread_id, in_reply_to=irt or None, references=refs,
        has_attachments=len(attachments) > 0, attachment_names=attachments,
        is_internal=is_int, is_sent_by_user=is_sent,
    )


def _parse_addr(val: str) -> Tuple[str, str]:
    """Parse 'Name <email>' into (email, name)."""
    try:
        addrs = getaddresses([val])
        if addrs:
            n, e = addrs[0]
            return e.strip(), n.strip().strip('"')
    except Exception:
        pass
    m = re.search(r'<([^>]+)>', val)
    if m:
        return m.group(1).strip(), re.sub(r'<[^>]+>', '', val).strip().strip('"')
    if "@" in val:
        return val.strip(), ""
    return "", val.strip()


def _decode(val: str) -> str:
    """Decode RFC 2047 encoded header."""
    try:
        return str(make_header(decode_header(val)))
    except Exception:
        return val


def _parse_dt(s: str) -> str:
    """Parse date to ISO format."""
    if not s:
        return datetime.now(timezone.utc).isoformat()
    try:
        return parsedate_to_datetime(s).isoformat()
    except Exception:
        for f in ["%a, %d %b %Y %H:%M:%S %z", "%d %b %Y %H:%M:%S %z",
                  "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]:
            try:
                dt = datetime.strptime(s.strip(), f)
                return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()
            except ValueError:
                continue
    return datetime.now(timezone.utc).isoformat()


def _body(msg: EmailMessage):
    """Extract text, html, attachments from MIME message."""
    text = html = None
    atts: List[str] = []

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = str(part.get("Content-Disposition", ""))
            if "attachment" in cd:
                fn = part.get_filename()
                if fn:
                    atts.append(fn)
                continue
            if ct == "text/plain" and text is None:
                try:
                    text = part.get_content()
                except Exception:
                    pass
            elif ct == "text/html" and html is None:
                try:
                    html = part.get_content()
                except Exception:
                    pass
    else:
        ct = msg.get_content_type()
        try:
            c = msg.get_content()
        except Exception:
            c = None
        if ct == "text/plain":
            text = c
        elif ct == "text/html":
            html = c

    if text:
        text = _strip(text)
        if len(text) > 5000:
            text = text[:5000] + "\n...[truncated]"
    if text is None and html:
        text = _strip(_html2txt(html))
        if len(text) > 5000:
            text = text[:5000] + "\n...[truncated]"

    return text, html, atts


def _strip(t: str) -> str:
    """Remove quoted replies."""
    pats = [r'(?m)^>.*$', r'(?m)^\s*>.*$', r'(?m)^On .*wrote:.*$',
            r'(?m)^---*\s*Original Message\s*---*$', r'(?m)^From:.*$',
            r'(?m)^Sent:.*$', r'(?m)^To:.*$', r'(?m)^Subject:.*$',
            r'(?m)^________________________________$']
    for p in pats:
        m = re.search(p, t)
        if m and m.start() > len(t) * 0.3:
            return t[:m.start()].strip()
    return t.strip()


def _html2txt(html: str) -> str:
    """HTML to plain text."""
    import html as hm
    html = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.I)
    html = re.sub(r'<br\s*/?>', '\n', html, flags=re.I)
    html = re.sub(r'</(p|div|h[1-6]|tr)>', '\n', html, flags=re.I)
    html = re.sub(r'<[^>]+>', '', html)
    html = hm.unescape(html)
    return re.sub(r'\n\s*\n', '\n\n', html).strip()


def _lang(t: str) -> Optional[str]:
    """Basic language detection."""
    if not t:
        return None
    s = t[:1000]
    if re.search(r'[\u0400-\u04FF]', s):
        return "ru"
    if re.search(r'[\u4E00-\u9FFF]', s):
        return "zh"
    if re.search(r'[\u0600-\u06FF]', s):
        return "ar"
    if re.search(r'[a-zA-Z]', s):
        return "en"
    return None
