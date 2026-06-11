@echo off
REM ============================================================
REM  M2 LOG Tool - 一鍵啟動
REM  啟動 M2-LOG-Tool.exe 並自動開啟瀏覽器。
REM ============================================================
setlocal
cd /d "%~dp0"

set "PORT=3000"
set "EXE=dist\M2-LOG-Tool.exe"

REM 若同層就有 EXE（發佈給使用者時的情況），優先使用
if exist "M2-LOG-Tool.exe" set "EXE=M2-LOG-Tool.exe"

if not exist "%EXE%" (
    echo [ERROR] 找不到 %EXE%
    echo 請先執行 build-exe.bat 產生執行檔，或把本檔與 EXE 放在同一資料夾。
    echo.
    pause
    exit /b 1
)

echo 啟動 M2 LOG Tool...
start "M2 LOG Tool" "%EXE%"

REM 等伺服器起來後開瀏覽器
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%"

echo.
echo M2 LOG Tool 已啟動：http://127.0.0.1:%PORT%
echo 關閉視窗不會停止伺服器；要停止請從工作管理員結束 M2-LOG-Tool.exe。
echo.
endlocal
