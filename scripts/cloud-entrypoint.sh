#!/bin/bash
# Cloud Run entrypoint.
#
# Brings up the Midnight chain, its indexer and a proof server, deploys the
# circuit, then serves the interface. All in one container because a wallet
# sync holds websockets open for minutes and proving needs a gigabyte of keys,
# neither of which survives a serverless request boundary.
set -u

cd /app

echo "[entrypoint] starting the chain"
bunx orchestrator start --config start.midnight-only.ts > /tmp/orchestrator.log 2>&1 &

echo "[entrypoint] waiting for the proof server"
for i in $(seq 1 180); do
  if curl -sf -o /dev/null http://127.0.0.1:6300/health 2>/dev/null; then
    echo "[entrypoint] proof server up after ${i}s"
    break
  fi
  sleep 1
done

echo "[entrypoint] waiting for the indexer"
for i in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8088/api/v4/graphql 2>/dev/null)
  if [ "$code" != "000" ]; then break; fi
  sleep 1
done

# A fresh chain needs a little time to generate the dust that pays for a
# deploy. Retry rather than dying on the first attempt.
echo "[entrypoint] deploying the circuit"
ADDR=""
for attempt in 1 2 3 4 5 6; do
  cd /app/packages/contracts-midnight
  MIDNIGHT_NETWORK_ID=undeployed bun run deploy-midnight.ts > /tmp/deploy.log 2>&1
  ADDR=$(grep -oE "Contract address: [a-f0-9]+" /tmp/deploy.log | tail -1 | cut -d' ' -f3)
  if [ -n "$ADDR" ]; then
    echo "[entrypoint] deployed at $ADDR on attempt $attempt"
    break
  fi
  echo "[entrypoint] deploy attempt $attempt did not land, waiting"
  sleep 45
done

if [ -z "$ADDR" ]; then
  echo "[entrypoint] could not deploy the circuit; serving anyway so the page loads"
fi

echo "[entrypoint] serving on ${PORT:-8080}"
cd /app/packages/contracts-midnight
exec bun run server.ts "$ADDR"
