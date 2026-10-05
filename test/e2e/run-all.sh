#!/usr/bin/env bash
# Run the whole end-to-end verification suite against the live stack.
# Requires the docker compose stack up (postgres, redis, mosquitto, server).
#   bash test/e2e/run-all.sh
cd "$(dirname "$0")"
SUITES=(e2e_milesight e2e_regression e2e_dual_level e2e_m3_dispatch e2e_dashboard
        e2e_admin_c e2e_recipients e2e_full_pilot e2e_antisat e2e_rls)
fail=0
for s in "${SUITES[@]}"; do
  r=$(bash "$s.sh" 2>&1 | grep -E '^RESULT:' || echo "RESULT: ❌ $s (no result / error)")
  printf "%-18s %s\n" "$s" "$r"
  echo "$r" | grep -q '✅' || fail=1
done
echo ""
[ "$fail" = "0" ] && echo "ALL E2E SUITES PASSED ✅" || { echo "SOME SUITES FAILED ❌"; exit 1; }
