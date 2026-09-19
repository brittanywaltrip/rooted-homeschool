#!/usr/bin/env bash
# Every harness, with a status code that means what it says.
#
# All four printed their results and three of them exited 0 regardless: a red
# run looked green to anything reading the exit code instead of the text. Each
# is now mutation-checked -- forcing one assertion to fail makes it exit
# nonzero -- and this runner aggregates them.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RC=0
run() { printf '\n══ %s ══\n' "$1"; shift; "$@"; local c=$?; [ $c -ne 0 ] && { echo "  -> FAILED (exit $c)"; RC=1; }; return 0; }
run "application scenarios"      node "$HERE/appscenarios.mjs"
run "two-session concurrency"    "$HERE/twosession.sh"
run "deadlock probe"             "$HERE/deadlock.sh"
run "rollback round trip"        "$HERE/rollback-roundtrip.sh"
printf '\n'
[ $RC -eq 0 ] && echo "ALL HARNESSES PASSED" || echo "ONE OR MORE HARNESSES FAILED"
exit $RC
