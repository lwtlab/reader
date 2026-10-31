#!/usr/bin/env bash
# Node's captured stderr is a socket and cannot be reopened as /dev/stderr.
# Keep Xvfb diagnostics in an owned ordinary file, then forward after teardown.
set -u
reader_xvfb_root=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/reader-xvfb.XXXXXX")
trap 'rm -rf -- "$reader_xvfb_root"' EXIT
xvfb-run -a --error-file="$reader_xvfb_root/server.log" "$@"
command_status=$?
if [[ -f "$reader_xvfb_root/server.log" ]]; then
  cat -- "$reader_xvfb_root/server.log" >&2
fi
exit "$command_status"
