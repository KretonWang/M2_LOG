@echo off
REM ============================================================
REM  M2 LOG Tool - Build Windows installer (electron-builder / NSIS)
REM  Output: dist\M2_LOG Setup <version>.exe
REM ============================================================
setlocal enableextensions
cd /d "%~dp0"

call :ensure_node
if errorlevel 1 (
    echo [ERROR] Node.js is required. Install from https://nodejs.org/ then retry.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies ...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        echo.
        pause
        exit /b 1
    )
)

echo [INFO] Building installer - first run downloads Electron binaries, please wait ...
call npm run dist
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Done. Installer is in: %~dp0dist
echo ========================================
echo.
if exist "%~dp0dist" start "" explorer "%~dp0dist"
pause
endlocal
exit /b 0

REM ============================================================
REM  Subroutine: ensure Node.js exists, auto-install if missing
REM ============================================================
:ensure_node
where node >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%v in ('node --version') do echo [INFO] Node.js %%v detected.
    exit /b 0
)

echo [INFO] Node.js not found. Trying automatic install via winget ...
where winget >nul 2>nul
if errorlevel 1 (
    echo [ERROR] winget (App Installer) is not available; cannot auto-install Node.js.
    exit /b 1
)

winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs\;%ProgramFiles(x86)%\nodejs\;%LOCALAPPDATA%\Programs\nodejs\"

where node >nul 2>nul
if errorlevel 1 (
    echo [WARN] Node.js installed but not visible in this session.
    echo        Please close this window and run this again.
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo [INFO] Node.js %%v installed.
exit /b 0
