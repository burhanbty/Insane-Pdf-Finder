#!/usr/bin/env bash
# ===================================================================
#  Kaynak Bul - macOS / Linux başlatma betiği
#  Mantık scripts/baslat.mjs içinde; burada yalnızca yönlendiriyoruz.
#
#  Kurulum + başlatma:      ./baslat.sh
#  Sadece kurulum:          ./baslat.sh --kurulum
#  Tarayıcıyı açmadan:     OPEN_BROWSER=0 ./baslat.sh
#  Farklı port:            PORT=3001 ./baslat.sh
# ===================================================================
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js bulunamadı."
  echo "  Lütfen Node.js 20 veya üzeri sürümü kurun: https://nodejs.org"
  echo
  exit 1
fi

exec node scripts/baslat.mjs "$@"