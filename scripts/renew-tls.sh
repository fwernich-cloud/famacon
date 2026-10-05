#!/bin/bash
# Renew the Let's Encrypt certificate and reload nginx. Safe to run often —
# certbot only renews when the cert is within 30 days of expiry.
set -e
cd "$(dirname "$0")/.."

docker run --rm \
  -v famacon-control_certbot-conf:/etc/letsencrypt \
  -v famacon-control_certbot-www:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet

# Reload nginx so it picks up a renewed cert (no downtime).
docker exec famacon-control-nginx-1 nginx -s reload 2>/dev/null || true

# Restart mosquitto so its TLS listener (8883) reloads the renewed cert. Brief blip;
# the gateways' Data Retransmission buffer covers the reconnect.
docker restart famacon-control-mosquitto-1 2>/dev/null || true
