@echo off
setlocal
cd /d "%~dp0"

echo.
echo   Kaynak Bul baslatiliyor...
echo   Kapatmak icin bu pencereyi kapat veya Ctrl+C bas.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   HATA: Node.js bulunamadi. https://nodejs.org adresinden kurun.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Ilk calistirma: paketler kuruluyor, biraz surebilir...
  call npm install
  if errorlevel 1 (
    echo.
    echo   HATA: paket kurulumu basarisiz oldu.
    pause
    exit /b 1
  )
)

start "" http://127.0.0.1:3000
node_modules\.bin\tsx src\server.ts

echo.
echo   Sunucu kapandi.
pause