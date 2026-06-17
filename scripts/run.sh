#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Go 에이전트 빌드 ─────────────────────────────────────────────
echo "🔨 Go 에이전트 빌드 중..."
if make -C "$ROOT" build-agent; then
  echo "✅ localwiki-agent 빌드 완료 → bin/localwiki-agent"
else
  echo "⚠️  Go 빌드 실패 — CLI 모드 사용 불가 (API 모드는 정상 작동)"
fi

# ── Python 백엔드 실행 ───────────────────────────────────────────
echo "🚀 백엔드 서버 시작..."
VENV_PATH=$(poetry -C "$ROOT/api" env info -p) && "$VENV_PATH/bin/python" -m api.main
