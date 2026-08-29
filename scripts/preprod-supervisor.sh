#!/bin/bash
# The preprod dust sync dies silently: the process stays alive, the stream stops
# emitting, and it waits forever. So watch the log for silence and restart.
LOG=/tmp/deploy-preprod.log
STALL=150   # seconds of no output before we call it dead
MAX=6
for attempt in $(seq 1 $MAX); do
  echo "=== attempt $attempt/$MAX $(date -u +%H:%M:%S) ==="
  pkill -f deploy-midnight.ts 2>/dev/null
  sleep 2
  rm -f $LOG
  cd /app/packages/contracts-midnight
  MIDNIGHT_NETWORK_ID=preprod NODE_OPTIONS=--max-old-space-size=6144 \
    bun run deploy-midnight.ts > $LOG 2>&1 &
  pid=$!
  last=0
  while kill -0 $pid 2>/dev/null; do
    sleep 30
    now=$(wc -l < $LOG 2>/dev/null || echo 0)
    if grep -qE "Contract deployed|Contract address:" $LOG 2>/dev/null; then
      echo "DEPLOYED on attempt $attempt"; grep -E "Contract address:" $LOG | tail -1; exit 0
    fi
    if [ "$now" = "$last" ]; then
      stalled=$((stalled+30))
      if [ $stalled -ge $STALL ]; then
        echo "stalled at $(grep -oE 'sync progress \([0-9]+s\)' $LOG | tail -1), restarting"
        kill $pid 2>/dev/null; break
      fi
    else
      stalled=0
    fi
    last=$now
  done
  wait $pid 2>/dev/null
  if grep -qE "Contract address:" $LOG 2>/dev/null; then
    echo "DEPLOYED on attempt $attempt"; grep -E "Contract address:" $LOG | tail -1; exit 0
  fi
done
echo "gave up after $MAX attempts"
grep -oE "sync progress \([0-9]+s\): .*" $LOG | tail -1
exit 1
