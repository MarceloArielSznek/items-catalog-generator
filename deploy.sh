#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "==> Pulling latest changes..."
git pull origin master

echo "==> Installing root dependencies..."
npm install

echo "==> Installing server dependencies..."
npm install --prefix server

echo "==> Installing client dependencies..."
npm install --prefix client

echo "==> Building client..."
npm run build --prefix client

echo "==> Restarting PM2 catalog process..."
pm2 restart catalog

echo "==> Deploy complete!"
pm2 list
