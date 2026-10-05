#!/usr/bin/env bash
# Proactive TLS-expiry alarm. Renewal is automated (renew-tls.sh via cron), but if
# that ever fails silently the cert lapses and EVERY gateway stops reporting at once,
# with no signal from the field — the classic Sunday failure. This turns that silent
# failure into a loud one: if the served cert is within THRESHOLD_DAYS of expiry, it
# sends a WhatsApp to the ops number so we fix it BEFORE anything drops.
#
#   bash scripts/cert-expiry-check.sh           (run daily via cron)
set -uo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-famaconcontrol.com}"
THRESHOLD_DAYS="${THRESHOLD_DAYS:-12}"
envval(){ grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

end=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
[ -z "$end" ] && { echo "$(date -u +%FT%TZ) ERROR: could not read cert for $DOMAIN"; exit 1; }

end_epoch=$(date -d "$end" +%s 2>/dev/null) || { echo "bad date: $end"; exit 1; }
days=$(( (end_epoch - $(date +%s)) / 86400 ))
echo "$(date -u +%FT%TZ) $DOMAIN cert expires in $days day(s) ($end)"

[ "$days" -gt "$THRESHOLD_DAYS" ] && exit 0   # healthy — stay quiet

# Within threshold → raise a WhatsApp alarm to the ops number.
TOK=$(envval WA_ACCESS_TOKEN); PNID=$(envval WA_PHONE_NUMBER_ID); TO=$(envval LEAD_NOTIFY_TO)
if [ -z "$TOK" ] || [ -z "$PNID" ] || [ -z "$TO" ]; then
  echo "$(date -u +%FT%TZ) WARN: cert within $THRESHOLD_DAYS days but WA creds / LEAD_NOTIFY_TO missing — cannot alert"
  exit 2
fi
TO_DIGITS=$(echo "$TO" | tr -cd '0-9')
curl -s -X POST "https://graph.facebook.com/v21.0/$PNID/messages" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d "{\"messaging_product\":\"whatsapp\",\"to\":\"$TO_DIGITS\",\"type\":\"template\",\"template\":{\"name\":\"famacon_nivel_urgente\",\"language\":{\"code\":\"es\"},\"components\":[{\"type\":\"body\",\"parameters\":[{\"type\":\"text\",\"text\":\"Servidor Famacon Control\"},{\"type\":\"text\",\"text\":\"El certificado TLS del broker vence en $days dias y no se renovo. Los gateways pueden dejar de reportar.\"},{\"type\":\"text\",\"text\":\"Revisar la renovacion (renew-tls.sh / certbot) cuanto antes.\"}]}]}}" \
  && echo " -> ops alert sent to WhatsApp"
