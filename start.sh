#!/bin/bash

# Claude Council - Start script

echo "Starting Claude Council..."
echo ""

# Require an Anthropic API key in .env
if [ ! -f .env ] || ! grep -Eq '^ANTHROPIC_(API_KEY|AUTH_TOKEN)=.+' .env; then
    echo "Error: ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is missing."
    echo "Copy .env.example to .env and add your key from https://console.anthropic.com/"
    exit 1
fi

# Start backend
echo "Starting backend on http://localhost:8001..."
uv run python -m backend.main &
BACKEND_PID=$!

# Wait a bit for backend to start
sleep 2

# Start frontend
echo "Starting frontend on http://localhost:5173..."
cd frontend
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✓ Claude Council is running!"
echo "  Backend:  http://localhost:8001"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
