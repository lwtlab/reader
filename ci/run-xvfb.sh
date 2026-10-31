#!/usr/bin/env bash
# Node's captured stderr is a socket and cannot be reopened as /dev/stderr.
# Keep Xvfb diagnostics in an owned ordinary file, then forward after teardown.
set -u
reader_xvfb_root=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/reader-xvfb.XXXXXX") || exit 1
trap 'rm -rf -- "$reader_xvfb_root"' EXIT
# Keep short readiness clients from resetting the server before Openbox connects.
reader_xvfb_args=(-a --error-file="$reader_xvfb_root/server.log")
if [[ "${READER_XVFB_NO_RESET:-1}" = 1 ]]; then
  reader_xvfb_args+=(--server-args='-screen 0 1280x1024x24 -nolisten tcp -noreset')
fi
xvfb-run "${reader_xvfb_args[@]}" "$@"
command_status=$?
if [[ -f "$reader_xvfb_root/server.log" ]]; then
  cat -- "$reader_xvfb_root/server.log" >&2
fi
exit "$command_status"
