#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:---fast}"

# Backend already running?
if curl -s --max-time 2 http://127.0.0.1:8001/health > /dev/null 2>&1; then
  echo "✅ 백엔드 실행 중 — 테스트 시작..."
  poetry -C "$ROOT/apps/api/api" run python "$ROOT/scripts/e2e_test.py" "$MODE"
  exit $?
fi

echo "🚀 백엔드 시작 중..."
poetry -C "$ROOT/apps/api/api" run python main.py &
API_PID=$!

cleanup() {
  echo ""
  echo "🛑 백엔드 종료 (PID $API_PID)"
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "⏳ 백엔드 준비 대기 (최대 30초)..."
"$ROOT/node_modules/.bin/wait-on" -t 30000 "http-get://127.0.0.1:8001/health"

echo "✅ 백엔드 준비 완료 — 테스트 시작..."
poetry -C "$ROOT/apps/api/api" run python "$ROOT/scripts/e2e_test.py" "$MODE"
