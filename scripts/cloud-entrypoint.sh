#!/bin/bash
# Cloud Run entrypoint.
#
# Starts the chain in the background and hands straight to the server, which
# binds its port immediately. A host kills a container that has not listened
# within a few minutes, and bringing up a chain takes longer than that.
#
# The chain inherits stdout rather than being piped or redirected to a file.
# A pipe here broke startup once, and a file on a hosted box is a log nobody
# can read.
set -u

cd /app
echo "[entrypoint] starting the chain"
bunx orchestrator start --config start.midnight-only.ts &

echo "[entrypoint] serving on ${PORT:-8080}"
cd /app/packages/ui
exec bun run server.ts
