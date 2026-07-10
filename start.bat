@echo off
setlocal enabledelayedexpansion
title LoomArc — Minecraft Panel
cd /d "%~dp0"

:: ── Colours (requires Windows 10 v1511+) ────────────────────────────────────
for /f %%A in ('echo prompt $E ^| cmd') do set "ESC=%%A"
set "C_RESET=%ESC%[0m"
set "C_BOLD=%ESC%[1m"
set "C_GREEN=%ESC%[32m"
set "C_YELLOW=%ESC%[33m"
set "C_RED=%ESC%[31m"
set "C_CYAN=%ESC%[36m"
set "C_PURPLE=%ESC%[35m"

echo.
echo %C_PURPLE%%C_BOLD%  LoomArc — Minecraft Network Panel%C_RESET%
echo   %C_CYAN%──────────────────────────────────%C_RESET%
echo.

:: ── Node.js check ────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo   %C_RED%✗  Node.js not found in PATH.%C_RESET%
    echo      Download it from https://nodejs.org ^(v18+^)
    pause
    exit /b 1
)

for /f "tokens=1" %%V in ('node --version 2^>^&1') do set NODE_VER=%%V
echo   %C_GREEN%✓%C_RESET%  Node.js %NODE_VER%

:: ── Java check ───────────────────────────────────────────────────────────────
where java >nul 2>&1
if errorlevel 1 (
    echo   %C_YELLOW%⚠  java not found in PATH — servers won't start until Java is installed.%C_RESET%
    echo      Download: https://adoptium.net/temurin/releases/?version=17
) else (
    for /f "tokens=*" %%V in ('java -version 2^>^&1 ^| findstr /i "version"') do (
        echo   %C_GREEN%✓%C_RESET%  %%V
        goto :java_ok
    )
    :java_ok
)
echo.

:: ── Install dependencies if missing ─────────────────────────────────────────
if not exist "node_modules\" (
    echo   %C_CYAN%→%C_RESET%  node_modules not found — running npm install...
    echo.
    npm install
    if errorlevel 1 (
        echo.
        echo   %C_RED%✗  npm install failed. See errors above.%C_RESET%
        pause
        exit /b 1
    )
    :: Approve better-sqlite3 native scripts if needed
    npm approve-scripts better-sqlite3 >nul 2>&1
    echo.
)

:: ── First-time setup ─────────────────────────────────────────────────────────
if not exist ".env" (
    echo   %C_CYAN%→%C_RESET%  First run — running setup...
    echo.
    node setup.js
    if errorlevel 1 (
        echo.
        echo   %C_RED%✗  Setup failed. See errors above.%C_RESET%
        pause
        exit /b 1
    )
    echo.
)

:: ── Read panel port from .env for the browser-open hint ─────────────────────
set "PANEL_PORT=3000"
for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
    if /i "%%A"=="PANEL_PORT" set "PANEL_PORT=%%B"
)

:: ── Start the panel ───────────────────────────────────────────────────────────
echo   %C_GREEN%✓%C_RESET%  Starting LoomArc panel...
echo   %C_CYAN%→%C_RESET%  Open %C_BOLD%http://localhost:%PANEL_PORT%%C_RESET% in your browser
echo.
echo   %C_YELLOW%Press Ctrl+C to stop the panel%C_RESET%
echo   %C_CYAN%──────────────────────────────────%C_RESET%
echo.

node src/server.js

echo.
echo   %C_YELLOW%Panel stopped.%C_RESET%
pause
