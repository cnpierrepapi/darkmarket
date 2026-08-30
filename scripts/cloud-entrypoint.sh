#!/bin/bash
# Cloud Run entrypoint.
#
# Starts the chain in the background and hands straight to the server, which
# binds its port immediately. A host kills a container that has not listened
# within a few minutes, and bringing up a chain takes longer than that.
#
# The chain's output goes to stdout, not a file. On a hosted box a log you
# cannot read is the same as no log at all.
set -u

cd /app
echo "[entrypoint] starting the chain"
bunx orchestrator start --config start.midnight-only.ts 2>&1 | sed -u 's/^/[chain] /' &

echo "[entrypoint] serving on ${PORT:-8080}"
cd /app/packages/ui
exec bun run server.ts
