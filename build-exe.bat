@echo off
REM ============================================================
REM  M2 LOG Tool - 一鍵打包 EXE
REM  會自動安裝相依套件並用 @yao-pkg/pkg 產生單一執行檔。
REM  輸出：dist\M2-LOG-Tool.exe
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   M2 LOG Tool - Build EXE
echo ========================================
echo.

REM --- 檢查 Node.js 是否安裝 ---
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 找不到 Node.js，請先安裝：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo [1/3] Node.js %NODE_VER% OK
echo.

REM --- 安裝相依套件（含打包工具） ---
echo [2/3] 安裝相依套件中...
call npm install
if errorlevel 1 (
    echo.
    echo [ERROR] npm install 失敗。
    pause
    exit /b 1
)
echo.

REM --- 打包成 EXE ---
echo [3/3] 打包 EXE 中（第一次會下載 Node 基礎檔，請稍候）...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] 打包失敗。
    pause
    exit /b 1
)

echo.
echo ========================================
echo   完成！輸出檔案：
echo   %~dp0dist\M2-LOG-Tool.exe
echo ========================================
echo.

REM --- 開啟輸出資料夾 ---
if exist "%~dp0dist" start "" explorer "%~dp0dist"

pause
endlocal
