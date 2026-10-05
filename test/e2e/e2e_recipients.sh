#!/usr/bin/env bash
# ── E2E: M3 recipients + auditable consent management (admin) ──────────────
set -uo pipefail
cd "$(dirname "$0")/../.."
PSQL(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
JAR=$(mktemp)
DU=$(grep -E '^DASHBOARD_USER=' .env|cut -d= -f2-|tr -d '"'); DP=$(grep -E '^DASHBOARD_PASSWORD=' .env|cut -d= -f2-|tr -d '"')
T=00000000-0000-0000-0000-0000000e2e60; F=00000000-0000-0000-0000-0000000e2e61
code(){ curl -s -o /dev/null -w "%{http_code}" -b "$JAR" -X "$1" "localhost:3000$2" -H 'content-type: application/json' ${3:+-d "$3"}; }
body(){ curl -s -b "$JAR" -X "$1" "localhost:3000$2" -H 'content-type: application/json' ${3:+-d "$3"}; }

echo "── setup + login ──"
PSQL >/dev/null <<SQL
DELETE FROM consent WHERE tenant_id='$T'; DELETE FROM recipient WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
INSERT INTO tenant(id,name) VALUES ('$T','E2E Recip');
INSERT INTO field(id,tenant_id,name) VALUES ('$F','$T','Campo Recip');
SQL
LC=$(curl -s -c "$JAR" -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/login -H 'content-type: application/json' -d "{\"user\":\"$DU\",\"password\":\"$DP\"}")
[ "$LC" = "200" ] && ok "login" || bad "login $LC"

echo "── lista vacía ──"
body GET "/api/recipients?field=$F" | grep -q '"recipients":\[\]' && ok "sin destinatarios al inicio" || bad "no vino lista vacía"

echo "── agregar 5 (tope) ──"
for i in 1 2 3 4 5; do C=$(code POST /api/recipients "{\"field\":\"$F\",\"name\":\"Dest $i\",\"phone_e164\":\"+54911000000$i\"}"); [ "$C" = "201" ] || bad "alta $i devolvió $C"; done
[ "$(PSQL -c "SELECT count(*) FROM recipient WHERE tenant_id='$T';")" = "5" ] && ok "5 destinatarios cargados" || bad "no hay 5"
echo "── 6º rechazado (máx 5) ──"
C6=$(code POST /api/recipients "{\"field\":\"$F\",\"name\":\"Dest 6\",\"phone_e164\":\"+549110000006\"}")
[ "$C6" = "409" ] && ok "6º rechazado (409, tope de 5)" || bad "esperaba 409, fue $C6"

R1=$(PSQL -c "SELECT id FROM recipient WHERE tenant_id='$T' AND phone_e164='+549110000001';")
echo "── consentimiento: sin él no está consentido ──"
body GET "/api/recipients?field=$F" | grep -q '"consented":false' && ok "arranca sin consentimiento" || bad "debería faltar consentimiento"

echo "── dar consentimiento (con IP + fecha) ──"
body POST /api/recipients/consent "{\"field\":\"$F\",\"recipientId\":\"$R1\",\"granted\":true}" >/dev/null
CG=$(PSQL -c "SELECT count(*) FROM consent WHERE recipient_id='$R1' AND granted AND revoked_at IS NULL AND granted_ip IS NOT NULL AND granted_at IS NOT NULL;")
[ "$CG" = "1" ] && ok "consentimiento registrado con IP + fecha (Ley 25.326)" || bad "consentimiento no auditado: $CG"
body GET "/api/recipients?field=$F" | grep -q '"consented":true' && ok "aparece consentido en la lista" || bad "no figura consentido"

echo "── revocar ──"
body POST /api/recipients/consent "{\"field\":\"$F\",\"recipientId\":\"$R1\",\"granted\":false}" >/dev/null
[ "$(PSQL -c "SELECT count(*) FROM consent WHERE recipient_id='$R1' AND revoked_at IS NOT NULL;")" -ge 1 ] && ok "consentimiento revocado (queda el registro)" || bad "no se revocó"

echo "── quitar destinatario ──"
body DELETE /api/recipients "{\"field\":\"$F\",\"recipientId\":\"$R1\"}" >/dev/null
[ "$(PSQL -c "SELECT count(*) FROM recipient WHERE tenant_id='$T';")" = "4" ] && ok "destinatario quitado (quedan 4)" || bad "no se quitó"

echo "── aislamiento: sin sesión → 401 ──"
[ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/recipients?field=$F)" = "401" ] && ok "sin login → 401" || bad "guard roto"

echo "── teardown ──"
PSQL >/dev/null <<SQL
DELETE FROM consent WHERE tenant_id='$T'; DELETE FROM recipient WHERE tenant_id='$T'; DELETE FROM field WHERE tenant_id='$T'; DELETE FROM tenant WHERE id='$T';
SQL
rm -f "$JAR"; echo "  cleaned up."
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ RECIPIENTS + CONSENT (M3) PASSED" || echo "RESULT: ❌ RECIPIENTS FAILED"
exit $FAIL
