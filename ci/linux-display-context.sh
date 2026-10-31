#!/usr/bin/env bash
# Run inside Xvfb. Preserve the command's failure and capture only X11 metadata.
set -u
"$@"
command_status=$?
if [[ "$command_status" -ne 0 ]]; then
  printf 'X11 failure context: DISPLAY=%s\n' "${DISPLAY:-unset}"
  if [[ -n "${XAUTHORITY:-}" ]]; then
    stat --format='Xauthority mode=%a uid=%u bytes=%s' -- "$XAUTHORITY" || true
  fi
  xprop -root _NET_SUPPORTING_WM_CHECK 2>&1 || true
  ps -C Xvfb,openbox -o pid=,args= || true
fi
exit "$command_status"
