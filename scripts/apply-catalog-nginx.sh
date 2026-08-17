#!/usr/bin/env bash
# Remove HTTP basic auth from catalog vhost (Payload login handles access).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="$ROOT/catalog.yallaprojects.com.nginx"
TARGET="/etc/nginx/sites-available/catalog.yallaprojects.com"

if [[ ! -f "$CONF" ]]; then
  echo "Missing $CONF"
  exit 1
fi

sudo cp "$CONF" "$TARGET"
sudo nginx -t
sudo systemctl reload nginx
echo "Nginx updated: basic auth removed for catalog.yallaprojects.com"
