#!/bin/bash
# CaseBoard Restart Script
# Stops the application (if running) and starts it again

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-restart}" in
    status)
        # shellcheck source=./config.sh
        source "$SCRIPT_DIR/config.sh"
        PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
        if [ -n "$PIDS" ]; then
            echo "✅ Application is running on port $PORT"
            echo "   PIDs: $PIDS"
            echo "🌐 Access the app at:"
            echo "   - Local: http://localhost:$PORT"
            echo "   - HTTPS: https://caseboard.moke.me"
            exit 0
        else
            echo "❌ Application is not running"
            exit 1
        fi
        ;;
    stop)
        exec "$SCRIPT_DIR/stop.sh"
        ;;
    start)
        exec "$SCRIPT_DIR/start.sh"
        ;;
    restart)
        echo "🔄 Restarting CaseBoard application..."
        "$SCRIPT_DIR/stop.sh"
        "$SCRIPT_DIR/start.sh"
        ;;
    *)
        echo "Usage: $0 [status|stop|start|restart]"
        exit 1
        ;;
esac
