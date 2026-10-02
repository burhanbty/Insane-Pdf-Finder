@echo off
REM ===================================================================
REM  Kaynak Bul - Windows baslatma betigi
REM  Mantik scripts/baslat.mjs icinde; burada yalnizca yonlendiriyoruz.
REM
REM  Kurulum + baslatma:      baslat.bat
REM  Sadece kurulum:          baslat.bat --kurulum
REM  Tarayiciyi acmadan:     set OPEN_BROWSER=0 && baslat.bat
REM  Farkli port:            set PORT=3001 && baslat.bat
REM ===================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadi.
  echo   Lutfen Node.js 20 veya uzeri surumu kurun: https://nodejs.org
  echo.
  pause
  exit /b 1
)

node scripts\baslat.mjs %*
exit /b %ERRORLEVEL%