@echo off
title RFQ Flow v4.3.2 - Windows Builder
color 0B
echo.
echo ============================================================
echo.
echo              RFQ FLOW v4.3.2 - WINDOWS BUILDER
echo.
echo ============================================================
echo.

REM Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js 20+ from https://nodejs.org/
    echo Then run this file again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%a in ('node --version') do set NODE_VERSION=%%a
echo [OK] Node.js %NODE_VERSION% found
echo.

REM Install all dependencies (including Electron)
echo [1/4] Installing dependencies (first run may take 2-3 minutes)...
echo.
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed!
    pause
    exit /b 1
)

REM Build React app
echo.
echo [2/4] Building React application...
echo.
call npm run build
if errorlevel 1 (
    echo [ERROR] React build failed!
    pause
    exit /b 1
)

REM Package with electron-builder
echo.
echo [3/4] Packaging Windows installer and portable app...
echo.
call npx electron-builder --win --x64
if errorlevel 1 (
    echo [ERROR] Electron build failed!
    echo.
    echo Trying alternative method with electron-builder directly...
    call npx electron-builder build --win --x64 --publish=never
    if errorlevel 1 (
        echo [ERROR] Alternative build also failed!
        pause
        exit /b 1
    )
)

echo.
echo ============================================================
echo.
echo                    BUILD COMPLETE!
echo.
echo ============================================================
echo.
echo Your RFQ Flow app is ready in the RELEASE folder:
echo.
echo   release\
echo   +-- RFQ-Flow-Setup-4.3.2.exe    (Installer - recommended)
echo   +-- RFQ Flow 4.3.2.exe          (Portable - runs anywhere)
echo.
echo To install:  Double-click RFQ-Flow-Setup-4.3.2.exe
echo Portable:    Copy "RFQ Flow 4.3.2.exe" to any folder and run
echo.
pause
