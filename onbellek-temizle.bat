@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadi. Lutfen https://nodejs.org adresinden kurun.
  pause
  exit /b 1
)

if exist ".cache\" rmdir /s /q ".cache"
if exist "downloads\" (
  echo   Not: Indirilen dosyalar downloads klasorunde saklanir ve silinmez.
)

echo.
echo   Onbellek temizlendi.
pause