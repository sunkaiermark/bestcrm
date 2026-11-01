#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
test "$#" = 7
test "$3" = ACAD2018 && test "$4" = DXF && test "$5" = 0 && test "$6" = 1 && test "$7" = drawing.dwg
input=$(readlink -f -- "$1")
output=$(readlink -f -- "$2")
job=$(dirname "$input")
test "$(basename "$input")" = input
test "$(basename "$output")" = output
test "$(dirname "$output")" = "$job"
case "$(basename "$job")" in bestcrm-cad-*) ;; *) echo 'Unexpected CAD temporary directory' >&2; exit 1;; esac
test -d "$input" && test -d "$output" && test -f "$input/drawing.dwg"
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
test -x "$here/payload/AppRun"
install -d -m 700 "$job/config" "$job/cache" "$job/runtime"
export XDG_CONFIG_HOME="$job/config" XDG_CACHE_HOME="$job/cache" XDG_RUNTIME_DIR="$job/runtime"
command -v xvfb-run >/dev/null
command -v xauth >/dev/null
export QT_QPA_PLATFORM=xcb
export LD_LIBRARY_PATH="$here/compat${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec /usr/bin/xvfb-run -a -s "-screen 0 1024x768x24 -nolisten tcp" "$here/payload/AppRun" "$input" "$output" "$3" "$4" "$5" "$6" "$7"
