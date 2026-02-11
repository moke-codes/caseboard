#!/bin/bash
# CaseBoard Stop Script
# Stops any running CaseBoard instance on the configured port

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./config.sh
source "$SCRIPT_DIR/config.sh"

echo "🛑 Stopping CaseBoard application..."
PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null || true
    sleep 2
    PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "$PIDS" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
    echo "✅ Stopped application"
else
    echo "ℹ️  No running processes found"
fi
