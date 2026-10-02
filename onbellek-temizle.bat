@echo off
REM ===================================================================
REM  Kaynak Bul - Onbellek temizleme
REM  Indirilen dosyalara dokunmaz; yalnizca .cache silinir.
REM ===================================================================
setlocal
cd /d "%~dp0"

if exist ".cache\" (
  rmdir /s /q ".cache"
  echo.
  echo   Onbellek temizlendi.
) else (
  echo.
  echo   Onbellek yok, temizlenecek bir sey yok.
)

echo   Not: Indirilen dosyalar downloads\ klasorunde duruyor ve silinmedi.
pause