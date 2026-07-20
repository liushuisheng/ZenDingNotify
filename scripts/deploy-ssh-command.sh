#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^deploy[[:space:]]+([0-9a-f]{40})$ ]]; then
  exec sudo -n /usr/local/sbin/deploy-zendingnotify "${BASH_REMATCH[1]}"
fi

echo "Only the deploy <commit-sha> command is allowed." >&2
exit 126
