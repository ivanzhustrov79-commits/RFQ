# RFQ Flow v4.3.2 - Windows Build Script
# Requires: Node.js 20+, Windows 11 Pro 64-bit

$Host.UI.RawUI.WindowTitle = "RFQ Flow - Windows Build"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "              RFQ FLOW v4.3.2 - WINDOWS BUILDER" -ForegroundColor Cyan
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "[OK] Node.js $nodeVersion found" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js 20+ from https://nodejs.org/"
    Read-Host "Press Enter to exit"
    exit 1
}

# Install dependencies
Write-Host ""
Write-Host "[1/4] Installing dependencies (first run may take 2-3 minutes)..." -ForegroundColor Yellow
Write-Host ""
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] npm install failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Build React app
Write-Host ""
Write-Host "[2/4] Building React application..." -ForegroundColor Yellow
Write-Host ""
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] React build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Package with electron-builder
Write-Host ""
Write-Host "[3/4] Packaging Windows installer and portable app..." -ForegroundColor Yellow
Write-Host ""
npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Electron build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "                    BUILD COMPLETE!" -ForegroundColor Green
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your RFQ Flow app is ready in the RELEASE folder:" -ForegroundColor White
Write-Host ""
Write-Host "  release\" -ForegroundColor Cyan
Write-Host "  +-- RFQ-Flow-Setup-4.3.2.exe    (Installer - recommended)" -ForegroundColor Green
Write-Host "  +-- RFQ Flow 4.3.2.exe          (Portable - runs anywhere)" -ForegroundColor Green
Write-Host ""
Write-Host "To install:  Double-click RFQ-Flow-Setup-4.3.2.exe" -ForegroundColor White
Write-Host "Portable:    Copy to any folder and run" -ForegroundColor White
Write-Host ""
Read-Host "Press Enter to exit"
