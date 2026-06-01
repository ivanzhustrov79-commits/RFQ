# RFQ Flow v4.3.2

Desktop application for managing Request-for-Quote (RFQ) email workflows. Reads emails from Mozilla Thunderbird MBOX files, classifies them using AI (BASE/SMART/BOOST modes), and presents them on a Kanban board.

## Windows 11 Pro 64-bit - ONE-CLICK INSTALL

### Requirements
- Windows 11 Pro 64-bit
- [Node.js 20+](https://nodejs.org/) (LTS recommended)

### ONE STEP: Double-click BUILD.bat

```
1. Extract this folder anywhere (Desktop, Documents, etc.)
2. Double-click BUILD.bat
3. Wait 3-5 minutes (installs automatically)
4. Done! Check the "release" folder
```

### What You Get

| File | Description |
|---|---|
| `release/RFQ-Flow-Setup-4.3.2.exe` | **Installer** - Creates Start Menu shortcut |
| `release/RFQ Flow 4.3.2.exe` | **Portable** - Run from USB, no install needed |

### Alternative: PowerShell Build
```powershell
# Right-click in folder → "Open in Terminal"
.\BUILD.ps1
```

---

## Architecture (Specification v4.3.2)

| Process | Technology | Role |
|---|---|---|
| **Electron Main** | Node.js + Chromium | Window, SQLite, IPC |
| **React Renderer** | React 19 + TypeScript | All UI rendering |
| **Python Service** | FastAPI + uvicorn | EML parsing, AI, OCR |

### AI Modes
- **BASE**: Learned rules only (no LLM), deterministic classification
- **SMART**: Ollama local with qwen3:7b model
- **BOOST**: Moonshot AI API for complex troubleshooting

### Features
- 6-step Kanban board (PR → RFQ Sent → RFQ Received → Negotiation → CI → CI Approved)
- Supplier pane with 5 KPI metrics
- Alarm board with 6 alarm types
- Exception queue with AI suggestions
- 4-level troubleshoot (Right-click anywhere)
- Streaming AI chat with typing animation
- BASE/SMART/BOOST mode selector
- Offline queue and circuit breaker

---

## Development

```bash
npm install       # Install dependencies
npm run dev       # Development server (localhost:5173)
npm run build     # Build React app for production
npm run dist      # Build Windows installer + portable
```

---

## License
Private - For authorized users only.
