#!/bin/bash
# Admiral Weekly Health Check — cron-wrapper.
# Larmar i Telegram om modulen kraschar eller inte blir klar inom 10 minuter.
#   run-weekly.sh            schemalagd körning (bara kl 03 svensk tid, en gång per vecka)
#   run-weekly.sh manual     manuell körning
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/var/log/admiral-healthcheck.log
TRIGGER="${1:-scheduled}"

# Cron kör i UTC; posterna 01:00 och 02:00 täcker sommar- och vintertid.
if [ "$TRIGGER" = "scheduled" ] && [ "$(TZ=Europe/Stockholm date +%H)" != "03" ]; then exit 0; fi

envval() { grep "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }
TOKEN=$(envval TELEGRAM_BOT_TOKEN)
CHAT=$(envval TELEGRAM_CHAT_ID)

cd "$DIR"
TS=$(date -u +%FT%TZ)
echo "=== $TS $TRIGGER ===" >> "$LOG"
timeout 600 /usr/bin/node bin/run.mjs --trigger="$TRIGGER" >> "$LOG" 2>&1
CODE=$?
if [ $CODE -ne 0 ]; then
  if [ $CODE -eq 124 ]; then WHY="avbröts efter 10 minuter"; else WHY="kraschade (exit $CODE)"; fi
  curl -s -o /dev/null "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT}" \
    --data-urlencode "text=⚠️ Admiral veckokontroll ${WHY} ($TS). Ingen rapport skickades. Logg: $LOG på VPS:en."
fi
exit $CODE
