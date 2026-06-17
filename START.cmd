@echo off
REM ============================================================
REM  M2 LOG Tool - START shortcut
REM  Delegates to M2_LOG.cmd (installs tools/deps, then launches).
REM ============================================================
cd /d "%~dp0"
call "%~dp0M2_LOG.cmd" %*
