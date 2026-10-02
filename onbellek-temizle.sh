#!/usr/bin/env bash
# ===================================================================
#  Kaynak Bul - Önbellek temizleme
#  İndirilen dosyalara dokunmaz; yalnızca .cache silinir.
# ===================================================================
set -euo pipefail

cd "$(dirname "$0")"

if [ -d ".cache" ]; then
  rm -rf .cache
  echo
  echo "  Önbellek temizlendi."
else
  echo
  echo "  Önbellek yok, temizlenecek bir şey yok."
fi

echo "  Not: İndirilen dosyalar downloads/ klasöründe duruyor ve silinmedi."