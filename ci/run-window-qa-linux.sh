#!/usr/bin/env bash
set -euo pipefail

# Keep the existing isolated window-manager readiness and cleanup contract.
openbox --sm-disable >/dev/null 2>&1 &
window_manager_pid=$!
trap 'kill "$window_manager_pid" 2>/dev/null || true; wait "$window_manager_pid" 2>/dev/null || true' EXIT

for attempt in {1..50}; do
  if xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -Eq 'window id # 0x[1-9a-fA-F]'; then
    node "$(dirname -- "${BASH_SOURCE[0]}")/verify-qa-source.mjs" run-window-qa "$@"
    exit 0
  fi
  if ! kill -0 "$window_manager_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
echo 'The isolated desktop window manager did not become ready.' >&2
exit 1
