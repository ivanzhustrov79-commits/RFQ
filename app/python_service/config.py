"""RFQ Flow Python Service - Configuration"""
import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
SCHEMAS_DIR = BASE_DIR / "schemas"
DB_PATH = DATA_DIR / "rfq_flow.db"

# Ensure data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Server
HOST = "127.0.0.1"
PORT = 8721
RELOAD = os.getenv("RFQ_ENV", "production") == "development"

# MBOX parsing
MAX_MBOX_SIZE_MB = 500
DEFAULT_MAX_EMAILS = 100
CHUNK_SIZE_BYTES = 8192

# Internal email addresses (same as Node.js)
INTERNAL_EMAILS = [
    "info@field-pro.ae",
    "vlebedinets@agro-pro2014.ru",
]
USER_EMAIL = "izhustrov@import-detal36.ru"

# NLP
SPACY_MODEL = "en_core_web_sm"
MIN_CONFIDENCE = 0.5

# Logging
LOG_LEVEL = os.getenv("RFQ_LOG_LEVEL", "INFO")
