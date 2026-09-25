@echo off
rem ===================================================================
rem  Keep this file PURE ASCII. cmd.exe reads .bat with the system ANSI
rem  codepage (GBK on Chinese Windows) while the file is UTF-8, so any
rem  non-ASCII bytes here get mis-decoded and swallow the following
rem  characters ("echo" becomes "ho"), killing the script immediately.
rem
rem  Likewise, start.ps1 is deliberately ASCII-only: Windows PowerShell
rem  5.1 reads a BOM-less file as ANSI, which corrupts non-ASCII string
rem  literals and breaks parsing. The Chinese UI text lives inside
rem  start.ps1 as \uXXXX escapes (ASCII source, correct output).
rem ===================================================================
chcp 65001 >nul
title Fanyipigai - local dev server
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*

set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo [ERROR] start.ps1 exited with code %RC%
  echo Copy the messages above to the developer.
) else (
  echo Server stopped.
)
echo Press any key to close this window . . .
pause >nul
exit /b %RC%
