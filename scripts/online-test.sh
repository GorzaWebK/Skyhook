#!/usr/bin/env bash
# Runs the online leaderboard tests against local Firebase emulators.
#   npm run test:online
#
# The database emulator is started directly with Java and the rules are
# loaded with curl (rather than "firebase emulators:exec"), because
# firebase-tools sends even localhost requests through HTTPS_PROXY when one
# is set, which breaks in proxied environments.
set -u
cd "$(dirname "$0")/.."

JAR=$(ls "$HOME"/.cache/firebase/emulators/firebase-database-emulator-v*.jar 2>/dev/null | sort -V | tail -1)
if [ -z "$JAR" ]; then
  npx firebase setup:emulators:database >/dev/null
  JAR=$(ls "$HOME"/.cache/firebase/emulators/firebase-database-emulator-v*.jar | sort -V | tail -1)
fi

npx firebase emulators:start --project demo-skyhook --only auth > test-results/auth-emulator.log 2>&1 &
AUTH_PID=$!
java -jar "$JAR" --host 127.0.0.1 --port 9000 > test-results/database-emulator.log 2>&1 &
DB_PID=$!
cleanup() { kill "$AUTH_PID" "$DB_PID" 2>/dev/null; wait 2>/dev/null; }
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 60); do
    curl -s --noproxy '*' -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "FAIL $1 did not start"
  exit 1
}
wait_for http://127.0.0.1:9099/
wait_for "http://127.0.0.1:9000/.json?ns=demo-skyhook"

# Load the security rules ("owner" is the emulator's admin token).
code=$(curl -s --noproxy '*' -o test-results/rules-load.json -w '%{http_code}' -X PUT \
  -H 'Authorization: Bearer owner' --data-binary @firebase/database.rules.json \
  'http://127.0.0.1:9000/.settings/rules.json?ns=demo-skyhook')
if [ "$code" != "200" ]; then
  echo "FAIL could not load database rules (HTTP $code): $(cat test-results/rules-load.json)"
  exit 1
fi

node tests/online.e2e.cjs
