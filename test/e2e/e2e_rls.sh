#!/usr/bin/env bash
# ── E2E: per-producer isolation via Postgres RLS (as the app role, not admin) ──
# Two producers A and B; verifies each sees only its own data, default-deny with
# no tenant context, and cross-tenant read AND write both blocked at the DB.
set -uo pipefail
cd "$(dirname "$0")/../.."
APP_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')
APP_USER=$(echo "$APP_URL" | sed -E 's#.*//([^:]+):.*#\1#'); APP_PASS=$(echo "$APP_URL" | sed -E 's#.*//[^:]+:([^@]+)@.*#\1#')
ADM(){ docker compose exec -T postgres psql -U famacon_admin -d famacon -qtA "$@"; }
APPSQL(){ docker compose exec -T -e PGPASSWORD="$APP_PASS" postgres psql -U "$APP_USER" -d famacon -qtA "$@"; }
FAIL=0; ok(){ echo "  ✓ $1"; }; bad(){ echo "  ✗ $1"; FAIL=1; }
A=00000000-0000-0000-0000-0000000a1000; FA=00000000-0000-0000-0000-0000000a1001; GA=00000000-0000-0000-0000-0000000a1002; SA=00000000-0000-0000-0000-0000000a1003
B=00000000-0000-0000-0000-0000000b2000; FB=00000000-0000-0000-0000-0000000b2001; GB=00000000-0000-0000-0000-0000000b2002; SB=00000000-0000-0000-0000-0000000b2003

echo "── seed dos productores A y B (como admin) ──"
ADM >/dev/null <<SQL
INSERT INTO tenant(id,name) VALUES ('$A','Productor A'),('$B','Productor B');
INSERT INTO field(id,tenant_id,name) VALUES ('$FA','$A','Campo A'),('$FB','$B','Campo B');
INSERT INTO gateway(id,tenant_id,field_id,ext_ref,hardware_profile) VALUES ('$GA','$A','$FA','gw-A','generic-json@1'),('$GB','$B','$FB','gw-B','generic-json@1');
INSERT INTO sensor(id,tenant_id,field_id,gateway_id,ext_ref,kind,tank_ref) VALUES
  ('$SA','$A','$FA','$GA','A-n','tank_level','tA'),('$SB','$B','$FB','$GB','B-n','tank_level','tB');
INSERT INTO reading(ts,tenant_id,field_id,sensor_id,kind,value) VALUES
  (now(),'$A','$FA','$SA','tank_level',11),(now(),'$B','$FB','$SB','tank_level',22);
SQL

VA=$(APPSQL -c "SET app.tenant_id='$A'; SELECT count(*)||':'||coalesce(max(value)::text,'-') FROM reading;")
[ "$VA" = "1:11" ] && ok "contexto A → ve solo su lectura (1, valor 11)" || bad "A vio '$VA' (esperaba 1:11)"
VB=$(APPSQL -c "SET app.tenant_id='$B'; SELECT count(*)||':'||coalesce(max(value)::text,'-') FROM reading;")
[ "$VB" = "1:22" ] && ok "contexto B → ve solo su lectura (1, valor 22)" || bad "B vio '$VB' (esperaba 1:22)"
V0=$(APPSQL -c "SELECT count(*) FROM reading WHERE tenant_id IN ('$A','$B');")
[ "$V0" = "0" ] && ok "sin app.tenant_id → 0 filas (default-deny)" || bad "vio $V0 sin contexto"
XW=$(APPSQL -c "SET app.tenant_id='$A'; INSERT INTO reading(ts,tenant_id,field_id,sensor_id,kind,value) VALUES (now(),'$B','$FB','$SB','tank_level',99);" 2>&1 | grep -c "row-level security\|violates")
[ "$XW" -ge 1 ] && ok "escritura cross-tenant → bloqueada (WITH CHECK)" || bad "¡pudo escribir cross-tenant!"
XR=$(APPSQL -c "SET app.tenant_id='$A'; SELECT count(*) FROM reading WHERE tenant_id='$B';")
[ "$XR" = "0" ] && ok "lectura cross-tenant explícita → 0 (aislado a nivel base)" || bad "vio $XR filas de B"

ADM >/dev/null <<SQL
DELETE FROM reading WHERE tenant_id IN ('$A','$B'); DELETE FROM sensor WHERE tenant_id IN ('$A','$B');
DELETE FROM gateway WHERE tenant_id IN ('$A','$B'); DELETE FROM field WHERE tenant_id IN ('$A','$B'); DELETE FROM tenant WHERE id IN ('$A','$B');
SQL
echo ""
[ "$FAIL" = "0" ] && echo "RESULT: ✅ RLS ISOLATION PASSED" || echo "RESULT: ❌ RLS FAILED"
exit $FAIL
