#!/bin/bash
# CaseBoard Start Script
# Starts the Nuxt dev server in the background

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./config.sh
source "$SCRIPT_DIR/config.sh"

echo "🚀 Starting CaseBoard application..."

cd "$APP_DIR" || {
    echo "❌ Error: Could not change to directory $APP_DIR"
    exit 1
}

if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

nohup npm run dev > "$LOG_FILE" 2>&1 &
DEV_PID=$!

echo "⏳ Waiting for server to start..."
MAX_ATTEMPTS=15
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if lsof -ti:$PORT > /dev/null 2>&1; then
        echo "✅ Application is running on port $PORT"
        echo "   PID: $DEV_PID"
        echo "🌐 Access the app at:"
        echo "   - Local: http://localhost:$PORT"
        echo "   - HTTPS: https://caseboard.moke.me"
        echo "📋 Logs: tail -f $LOG_FILE"
        exit 0
    fi
    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
done

echo "❌ Error: Application failed to start after ${MAX_ATTEMPTS} seconds"
echo "📋 Check logs: tail -f $LOG_FILE"
kill $DEV_PID 2>/dev/null || true
exit 1
