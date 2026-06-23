"""RFQ Flow Python Service - Pydantic Models"""
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime


# ── Shared ──
class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    error_detail: Optional[str] = None


class SuccessResponse(BaseModel):
    success: bool = True


# ── MBOX Parsing ──
class MboxParseOptions(BaseModel):
    parse_body: bool = True
    extract_attachments: bool = False
    detect_language: bool = True


class MboxParseRequest(BaseModel):
    mbox_path: str = Field(..., description="Absolute path to MBOX file")
    max_emails: int = Field(default=10000, ge=1, le=50000)
    options: MboxParseOptions = Field(default_factory=MboxParseOptions)


class AttachmentInfo(BaseModel):
    filename: str
    content_type: Optional[str] = None
    size: Optional[int] = None


class ParsedEmail(BaseModel):
    id: int
    message_id: str
    subject: str
    sender_email: str
    sender_name: str
    sender_domain: str
    sent_at: str
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    body_language: Optional[str] = None
    thread_id: Optional[str] = None
    in_reply_to: Optional[str] = None
    references: List[str] = Field(default_factory=list)
    has_attachments: bool = False
    attachment_names: List[str] = Field(default_factory=list)
    is_internal: bool = False
    is_sent_by_user: bool = False


class MboxParseResponse(BaseModel):
    success: bool = True
    file: str
    path: str
    total_in_file: int
    returned: int
    emails: List[ParsedEmail]


# ── NLP ──
class PartNumberExtracted(BaseModel):
    part_number: str
    description: Optional[str] = None
    quantity: Optional[int] = None
    quantity_confidence: float = 0.0
    currency: Optional[str] = None
    unit_price: Optional[float] = None
    price_confidence: float = 0.0


class RfqExtracted(BaseModel):
    supplier_name: Optional[str] = None
    supplier_name_confidence: float = 0.0
    part_numbers: List[PartNumberExtracted] = Field(default_factory=list)
    rfq_name: Optional[str] = None
    rfq_name_source: str = "auto"
    ci_number: Optional[str] = None
    detected_language: Optional[str] = None
    translation: Optional[str] = None


class NlpExtractRequest(BaseModel):
    email_id: int
    subject: str
    body_text: str
    sender_domain: str
    body_language: Optional[str] = None


class NlpExtractResponse(BaseModel):
    success: bool = True
    email_id: int
    extracted: RfqExtracted


class PreviousEmailRef(BaseModel):
    subject: str
    step: int


class StepAlternative(BaseModel):
    step: int
    confidence: float


class StepClassification(BaseModel):
    suggested_step: int
    step_name: str
    confidence: float
    reason: str
    alternative_steps: List[StepAlternative] = Field(default_factory=list)
    is_low_confidence: bool = False
    has_conflict: bool = False
    signal_type: str = "neutral"  # "advances" | "holds" | "neutral"


class NlpClassifyRequest(BaseModel):
    email_id: int
    subject: str
    body_text: str
    sender_role: str = "unknown"  # "boss" | "user" | "supplier" | "unknown" — see database.determine_sender_role
    previous_emails_in_thread: List[PreviousEmailRef] = Field(default_factory=list)


class NlpClassifyResponse(BaseModel):
    success: bool = True
    email_id: int
    classification: StepClassification


# ── Database ──
class DbEmailRequest(ParsedEmail):
    """Same as ParsedEmail but used for DB storage."""
    profile_name: str
    account_email: str
    folder_path: str
    step_assigned: int = 0
    rfq_id: Optional[int] = None
    supplier_id: Optional[int] = None


class DbEmailResponse(BaseModel):
    success: bool = True
    email_id: int
    action: str  # "inserted" | "updated" | "unchanged"


class DbSupplierResponse(BaseModel):
    success: bool = True
    found: bool
    supplier: Optional[Dict[str, Any]] = None


class DbSupplierRequest(BaseModel):
    name: str
    email_domain: str
    contact_email: Optional[str] = None
    default_currency: str = "USD"


class DbSupplierWriteResponse(BaseModel):
    success: bool = True
    supplier_id: int
    action: str  # "inserted" | "updated"


class DbEmailsQueryResponse(BaseModel):
    success: bool = True
    total: int
    returned: int
    offset: int
    emails: List[Dict[str, Any]]


# ── Health ──
class HealthResponse(BaseModel):
    status: str  # "ok" | "degraded"
    version: str = "4.3.2"
    services: Dict[str, str]
    uptime_seconds: Optional[int] = None
