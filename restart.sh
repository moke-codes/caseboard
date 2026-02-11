#!/bin/bash

# CaseBoard Restart Script
# This script stops any running instance and starts the Nuxt dev server
# Usage: ./restart.sh [status|stop|start]

set -e

APP_DIR="/var/www/moke.me/html/caseboard"
PORT=3000
LOG_FILE="/tmp/caseboard.log"

# Function to check status
check_status() {
    PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        echo "✅ Application is running on port $PORT"
        echo "   PIDs: $PIDS"
        echo "🌐 Access the app at:"
        echo "   - Local: http://localhost:$PORT"
        echo "   - HTTPS: https://caseboard.moke.me"
        return 0
    else
        echo "❌ Application is not running"
        return 1
    fi
}

# Function to stop the application
stop_app() {
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
}

# Handle command line arguments
case "${1:-restart}" in
    status)
        check_status
        exit $?
        ;;
    stop)
        stop_app
        exit 0
        ;;
    start)
        echo "🚀 Starting CaseBoard application..."
        ;;
    restart)
        echo "🔄 Restarting CaseBoard application..."
        ;;
    *)
        echo "Usage: $0 [status|stop|start|restart]"
        exit 1
        ;;
esac

# For restart and start, continue with the restart logic
if [ "${1:-restart}" != "stop" ] && [ "${1:-restart}" != "status" ]; then
    # Change to app directory
    cd "$APP_DIR" || {
        echo "❌ Error: Could not change to directory $APP_DIR"
        exit 1
    }

    # Stop any existing processes on port 3000
    if [ "${1:-restart}" = "restart" ]; then
        stop_app
    fi

    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo "📦 Installing dependencies..."
        npm install
    fi

    # Start the application
    nohup npm run dev > "$LOG_FILE" 2>&1 &
    DEV_PID=$!

    # Wait for the server to start (check multiple times)
    echo "⏳ Waiting for server to start..."
    MAX_ATTEMPTS=15
    ATTEMPT=0
    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        if lsof -ti:$PORT > /dev/null 2>&1; then
            check_status
            echo "📋 Logs: tail -f $LOG_FILE"
            exit 0
        fi
        sleep 1
        ATTEMPT=$((ATTEMPT + 1))
    done

    # If we get here, the server didn't start
    echo "❌ Error: Application failed to start after ${MAX_ATTEMPTS} seconds"
    echo "📋 Check logs: tail -f $LOG_FILE"
    # Try to kill the process if it's hanging
    kill $DEV_PID 2>/dev/null || true
    exit 1
fi
