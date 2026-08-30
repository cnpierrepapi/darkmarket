#!/bin/bash
# Cloud Run entrypoint.
#
# Starts the chain in the background and hands straight to the server, which
# binds its port immediately. A host kills a container that has not listened
# within a few minutes, and bringing up a chain plus deploying a circuit takes
# longer than that, so none of it may block the bind.
set -u

cd /app
echo "[entrypoint] starting the chain in the background"
bunx orchestrator start --config start.midnight-only.ts > /tmp/orchestrator.log 2>&1 &

echo "[entrypoint] serving on ${PORT:-8080}"
cd /app/packages/ui
exec bun run server.ts
