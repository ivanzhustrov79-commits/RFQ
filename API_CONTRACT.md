# RFQ Flow v4.3.2 - Python Microservice API Contract

## 1. Architecture Overview

```
Electron Main (Node.js)  <--HTTP-->  Python FastAPI (127.0.0.1:8721)
       |                                      |
       v                                      v
   IPC Bridge                         NLP / SQLite / AI
   React Renderer
```

**Port:** Python binds to `127.0.0.1:8721` only (local, no external access)

**Lifecycle:**
1. Electron starts Python on app launch
2. Poll `GET /health` every 500ms until 200 OK (30s timeout)
3. On quit: `POST /shutdown` -> wait 5s -> SIGTERM -> SIGKILL
4. If Python fails: fall back to Node.js scanner (offline mode)

---

## 2. Endpoints

### 2.1 GET /health

**Response 200:**
```json
{
  "status": "ok",
  "version": "4.3.2",
  "services": {
    "database": "ok",
    "nlp": "ok"
  }
}
```

**Response 503 (degraded):**
```json
{
  "status": "degraded",
  "version": "4.3.2",
  "services": {
    "database": "ok",
    "nlp": "error: model not loaded"
  }
}
```

---

### 2.2 POST /mbox/parse

Replaces Node.js `thunderbird:readMbox` IPC handler.

**Request:**
```json
{
  "mbox_path": "C:/Users/.../Thunderbird/Profiles/xxx.default/Mail/imap.gmail.com/INBOX",
  "max_emails": 100,
  "options": {
    "parse_body": true,
    "extract_attachments": false,
    "detect_language": true
  }
}
```

**Response 200:**
```json
{
  "success": true,
  "file": "INBOX",
  "path": "C:/Users/.../INBOX",
  "total_in_file": 15234,
  "returned": 100,
  "emails": [
    {
      "id": 1001,
      "message_id": "<abc123@mail.gmail.com>",
      "subject": "Re: RFQ for hydraulic pump",
      "sender_email": "supplier@example.com",
      "sender_name": "Supplier Name",
      "sender_domain": "example.com",
      "sent_at": "2026-05-28T14:30:00Z",
      "body_text": "Dear Sir,...",
      "body_html": "<html>...</html>",
      "body_language": "en",
      "thread_id": "thread_abc123",
      "in_reply_to": "<parent@msg.com>",
      "references": ["<parent@msg.com>"],
      "has_attachments": true,
      "attachment_names": ["quote.pdf"],
      "is_internal": false,
      "is_sent_by_user": false
    }
  ]
}
```

**Response 400 (file too large):**
```json
{
  "success": false,
  "error": "FILE_TOO_LARGE",
  "error_detail": "File size 350MB exceeds 200MB limit",
  "max_size_mb": 200
}
```

**Response 404:**
```json
{
  "success": false,
  "error": "FILE_NOT_FOUND",
  "error_detail": "Path does not exist"
}
```

---

### 2.3 POST /nlp/extract-rfq

Extracts supplier name, part numbers, RFQ name from email body.

**Request:**
```json
{
  "email_id": 1001,
  "subject": "Re: RFQ for hydraulic pump",
  "body_text": "Dear Sir, please quote for part number CAT-12345, qty 10 pcs...",
  "sender_domain": "example.com",
  "body_language": "en"
}
```

**Response 200:**
```json
{
  "success": true,
  "email_id": 1001,
  "extracted": {
    "supplier_name": "NINGBO COMBINE MACHINERY",
    "supplier_name_confidence": 0.94,
    "part_numbers": [
      {
        "part_number": "CAT-12345",
        "description": "Hydraulic pump main body",
        "quantity": 10,
        "quantity_confidence": 0.98,
        "currency": "USD",
        "unit_price": null,
        "price_confidence": 0.0
      }
    ],
    "rfq_name": "RFQ - Hydraulic Pump CAT-12345",
    "rfq_name_source": "auto",
    "ci_number": null,
    "detected_language": "en",
    "translation": null
  }
}
```

---

### 2.4 POST /nlp/classify-step

Classifies email to workflow step (1-7).

**Request:**
```json
{
  "email_id": 1001,
  "subject": "Re: RFQ for hydraulic pump",
  "body_text": "Please find attached our quotation...",
  "previous_emails_in_thread": [
    {"subject": "RFQ for hydraulic pump", "step": 1}
  ]
}
```

**Response 200:**
```json
{
  "success": true,
  "email_id": 1001,
  "classification": {
    "suggested_step": 2,
    "step_name": "Quote Received",
    "confidence": 0.87,
    "reason": "Contains price quote and attachment",
    "alternative_steps": [
      {"step": 3, "confidence": 0.10},
      {"step": 1, "confidence": 0.03}
    ],
    "is_low_confidence": false,
    "has_conflict": false
  }
}
```

---

### 2.5 POST /db/email

Store parsed email in SQLite.

**Request:** (same email format as /mbox/parse response)
```json
{
  "profile_name": "default-release",
  "account_email": "commercial@field-pro.ae",
  "folder_path": "INBOX",
  "message_id": "<abc123@mail.gmail.com>",
  "subject": "Re: RFQ for hydraulic pump",
  "sender_email": "supplier@example.com",
  "sender_name": "Supplier Name",
  "sent_at": "2026-05-28T14:30:00Z",
  "body_text": "Dear Sir,...",
  "body_language": "en",
  "has_attachments": true,
  "thread_id": "thread_abc123",
  "step_assigned": 2,
  "rfq_id": null,
  "supplier_id": null
}
```

**Response 200:**
```json
{
  "success": true,
  "email_id": 1001,
  "action": "inserted"
}
```

---

### 2.6 GET /db/emails

Query stored emails with filters.

**Query parameters:**
- `account` - account email (required)
- `folder` - folder path (optional)
- `step` - workflow step number (optional)
- `supplier_id` - supplier filter (optional)
- `limit` - max results, default 100
- `offset` - pagination offset, default 0

**Response 200:**
```json
{
  "success": true,
  "total": 523,
  "returned": 100,
  "offset": 0,
  "emails": [ ... ]
}
```

---

### 2.7 GET /db/supplier

Get supplier by email domain.

**Query parameters:**
- `domain` - email domain (e.g. "example.com")

**Response 200 (found):**
```json
{
  "success": true,
  "found": true,
  "supplier": {
    "id": 5,
    "name": "NINGBO COMBINE MACHINERY",
    "email_domain": "example.com",
    "contact_email": "sales@example.com",
    "default_currency": "USD",
    "open_rfq_count": 3,
    "created_at": "2025-01-15T00:00:00Z"
  }
}
```

**Response 200 (not found):**
```json
{
  "success": true,
  "found": false,
  "supplier": null
}
```

---

### 2.8 POST /db/supplier

Create or update supplier.

**Request:**
```json
{
  "name": "NINGBO COMBINE MACHINERY",
  "email_domain": "example.com",
  "contact_email": "sales@example.com",
  "default_currency": "USD"
}
```

**Response 200:**
```json
{
  "success": true,
  "supplier_id": 5,
  "action": "inserted"
}
```

---

### 2.9 POST /shutdown

Graceful shutdown.

**Response 200:**
```json
{"status": "shutting_down"}
```

---

## 3. Error Handling

### Error Codes

| Code | HTTP | Meaning | Node.js Action |
|------|------|---------|----------------|
| `OK` | 200 | Success | Pass to React |
| `FILE_TOO_LARGE` | 400 | MBOX > 200MB | Show warning, offer partial read |
| `FILE_NOT_FOUND` | 404 | Path invalid | Log error, skip file |
| `PARSE_ERROR` | 422 | Corrupted MBOX | Return partial results if possible |
| `NLP_ERROR` | 500 | Model failed | Return raw email without AI data |
| `DB_ERROR` | 500 | SQLite issue | Log, retry once, then skip |
| `TIMEOUT` | 504 | Request too slow | Cancel, show "AI busy" indicator |

### Retry Logic (Node.js side)

```javascript
async function callPython(endpoint, payload, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:8721${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return await res.json();
      if (res.status >= 500 && i < retries) continue;
      return { success: false, error: `HTTP ${res.status}` };
    } catch (err) {
      if (i < retries && err.name === 'TimeoutError') continue;
      return { success: false, error: err.message };
    }
  }
}
```

---

## 4. SQLite Schema

```sql
-- Suppliers (auto-created from sender domains)
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email_domain TEXT UNIQUE NOT NULL,
  contact_email TEXT,
  default_currency TEXT DEFAULT 'USD',
  open_rfq_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- RFQs (one per part number conversation thread)
CREATE TABLE rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  rfq_name TEXT NOT NULL,
  rfq_name_source TEXT DEFAULT 'auto',
  ci_number TEXT,
  current_step INTEGER DEFAULT 1,
  status TEXT DEFAULT 'Open',
  source_language TEXT,
  translated_name TEXT,
  confidence_score REAL,
  alarm_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Emails (parsed from Thunderbird MBOX)
CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_name TEXT NOT NULL,
  account_email TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  message_id TEXT UNIQUE NOT NULL,
  subject TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,
  sent_at TEXT NOT NULL,
  body_text TEXT,
  body_language TEXT,
  has_attachments INTEGER DEFAULT 0,
  thread_id TEXT,
  step_assigned INTEGER DEFAULT 0,
  rfq_id INTEGER REFERENCES rfqs(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  parsed_at TEXT DEFAULT (datetime('now'))
);

-- Part numbers extracted from emails
CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER REFERENCES rfqs(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  part_number TEXT NOT NULL,
  description TEXT,
  quantity INTEGER,
  price REAL,
  currency TEXT,
  is_best_price INTEGER DEFAULT 0,
  quoted_at TEXT
);

-- Alarms
CREATE TABLE alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER REFERENCES rfqs(id),
  alarm_type TEXT NOT NULL,
  urgency TEXT DEFAULT 'Medium',
  reason TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_emails_account ON emails(account_email, folder_path);
CREATE INDEX idx_emails_thread ON emails(thread_id);
CREATE INDEX idx_emails_sender ON emails(sender_email);
CREATE INDEX idx_parts_rfq ON parts(rfq_id);
```

---

## 5. Python File Structure

```
python_service/
  main.py              # FastAPI app, routes
  config.py            # Settings, paths, constants
  models.py            # Pydantic models (requests/responses)
  database.py          # SQLite connection, migrations
  mbox_parser.py       # MBOX reading (replaces Node scanner)
  nlp/
    __init__.py
    extractor.py       # Supplier/part number extraction
    classifier.py      # Workflow step classification
    translator.py      # Language detection & translation
  ai/
    __init__.py
    ollama_client.py   # Local LLM integration (optional)
  schemas/
    init_db.sql        # SQLite schema
  data/
    rfq_flow.db        # SQLite database (runtime, .gitignored)
  requirements.txt
```

---

## 6. Integration Sequence (Sprints)

```
Phase 1: Standalone (Week 1)
  [Python] FastAPI server starts, /health responds
  [Node] main.js starts Python on app launch
  Test: Run both, GET /health returns 200

Phase 2: MBOX Parsing (Week 2)
  [Python] POST /mbox/parse reads MBOX, returns JSON
  [Node] thunderbird:readMbox IPC calls Python via HTTP
  Test: Click folder in UI -> emails appear (from Python)

Phase 3: Database (Week 3)
  [Python] All /db/* endpoints work
  [Node] After scan, emails persisted to SQLite
  Test: Restart app -> previously synced emails load from DB

Phase 4: NLP (Week 4)
  [Python] /nlp/extract-rfq and /nlp/classify-step
  [Node] After parsing, call NLP, update email with extracted data
  Test: Supplier name auto-extracted, workflow step auto-assigned

Phase 5: AI Integration (Week 5+)
  [Python] Ollama/LLM integration for advanced analysis
  [Node] "AI Mode" toggle controls NLP depth
  Test: AI suggests RFQ names, detects anomalies
```

---

## 7. Freeze Rules

This contract is frozen at Phase boundaries:

| Phase | Freeze Condition | What Can Change |
|-------|-----------------|-----------------|
| 1 | After /health works | Nothing until Phase 1 test passes |
| 2 | After MBOX parse works | Only response field additions (backward compat) |
| 3 | After DB works | Only new query parameters (optional) |
| 4 | After NLP works | Only new NLP models (same API) |
| 5 | Open | Free iteration on AI features |

**Rule:** A Phase N+1 endpoint CANNOT require a change to a Phase N endpoint response format. Only additions allowed.

---

## 8. Environment Requirements

| Dependency | Version | Purpose |
|-----------|---------|---------|
| Python | 3.11+ | Runtime |
| FastAPI | 0.115+ | Web framework |
| Uvicorn | 0.34+ | ASGI server |
| Pydantic | 2.10+ | Data validation |
| aiosqlite | 0.21+ | Async SQLite |
| spacy | 3.8+ | NLP pipeline |
| langdetect | 1.0.9 | Language detection |
| mail-parser | 3.15+ | Email parsing |

**Optional (Phase 5):**
| ollama | 0.4+ | Local LLM |
| httpx | 0.27+ | Async HTTP for Ollama |
