#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="/opt/ZenDingNotify"
readonly SERVICE="zendingnotify.service"
readonly DEPLOY_SHA="${1:-}"
RUNTIME_BACKUP=""

if [[ ! "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid deployment commit: $DEPLOY_SHA" >&2
  exit 2
fi

if [[ ! -s "$APP_DIR/data/config.json" || ! -s "$APP_DIR/data/store.json" ]]; then
  echo "Runtime data files are missing; refusing to deploy." >&2
  exit 3
fi

readonly PREVIOUS_SHA="$(runuser -u zendingnotify -- git -C "$APP_DIR" rev-parse HEAD)"

cleanup() {
  if [[ -n "$RUNTIME_BACKUP" && -d "$RUNTIME_BACKUP" ]] && ! systemctl is-active --quiet "$SERVICE"; then
    install -d -m 750 -o zendingnotify -g zendingnotify "$APP_DIR/data"
    install -m 600 -o zendingnotify -g zendingnotify "$RUNTIME_BACKUP/config.json" "$APP_DIR/data/config.json"
    install -m 600 -o zendingnotify -g zendingnotify "$RUNTIME_BACKUP/store.json" "$APP_DIR/data/store.json"
    systemctl restart "$SERVICE" || true
  fi
  if [[ -n "$RUNTIME_BACKUP" && -d "$RUNTIME_BACKUP" ]]; then
    rm -rf -- "$RUNTIME_BACKUP"
  fi
}

trap cleanup EXIT

systemctl stop "$SERVICE"

RUNTIME_BACKUP="$(mktemp -d /var/tmp/zendingnotify-runtime.XXXXXX)"
install -m 600 -o zendingnotify -g zendingnotify "$APP_DIR/data/config.json" "$RUNTIME_BACKUP/config.json"
install -m 600 -o zendingnotify -g zendingnotify "$APP_DIR/data/store.json" "$RUNTIME_BACKUP/store.json"

readonly CONFIG_HASH="$(sha256sum "$RUNTIME_BACKUP/config.json" | awk '{print $1}')"
readonly STORE_HASH="$(sha256sum "$RUNTIME_BACKUP/store.json" | awk '{print $1}')"

restore_runtime_data() {
  install -d -m 750 -o zendingnotify -g zendingnotify "$APP_DIR/data"
  install -m 600 -o zendingnotify -g zendingnotify "$RUNTIME_BACKUP/config.json" "$APP_DIR/data/config.json"
  install -m 600 -o zendingnotify -g zendingnotify "$RUNTIME_BACKUP/store.json" "$APP_DIR/data/store.json"
}

rollback() {
  echo "Deployment failed; rolling back to $PREVIOUS_SHA" >&2
  runuser -u zendingnotify -- git -C "$APP_DIR" reset --hard "$PREVIOUS_SHA"
  restore_runtime_data
  systemctl restart "$SERVICE"
}

runuser -u zendingnotify -- git -C "$APP_DIR" fetch --prune origin main

readonly REMOTE_SHA="$(runuser -u zendingnotify -- git -C "$APP_DIR" rev-parse origin/main)"
if [[ "$REMOTE_SHA" != "$DEPLOY_SHA" ]]; then
  echo "origin/main is $REMOTE_SHA, expected $DEPLOY_SHA" >&2
  exit 4
fi

runuser -u zendingnotify -- git -C "$APP_DIR" reset --hard "$DEPLOY_SHA"
restore_runtime_data

if [[ "$(sha256sum "$APP_DIR/data/config.json" | awk '{print $1}')" != "$CONFIG_HASH" ]] ||
   [[ "$(sha256sum "$APP_DIR/data/store.json" | awk '{print $1}')" != "$STORE_HASH" ]]; then
  rollback
  echo "Runtime data changed during deployment." >&2
  exit 5
fi

if ! runuser -u zendingnotify -- bash -lc "cd '$APP_DIR' && npm run check && node --check public/app.js"; then
  rollback
  exit 6
fi

systemctl restart "$SERVICE"

for attempt in {1..12}; do
  if systemctl is-active --quiet "$SERVICE" && curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8787/ >/dev/null; then
    echo "Successfully deployed $DEPLOY_SHA"
    exit 0
  fi
  sleep 2
done

rollback
echo "Health check failed after deployment." >&2
exit 7
