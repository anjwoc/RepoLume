#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Go 에이전트 빌드 ─────────────────────────────────────────────
AGENT_DIR="$SCRIPT_DIR/agent"
AGENT_BIN="$SCRIPT_DIR/localwiki-agent"

echo "🔨 Go 에이전트 빌드 중..."
if (cd "$AGENT_DIR" && go build -o "$AGENT_BIN" ./cmd/localwiki-agent/); then
  echo "✅ localwiki-agent 빌드 완료"
else
  echo "⚠️  Go 빌드 실패 — CLI 모드 사용 불가 (API 모드는 정상 작동)"
fi

# ── Python 백엔드 실행 ───────────────────────────────────────────
echo "🚀 백엔드 서버 시작..."
VENV_PATH=$(poetry -C api env info -p) && $VENV_PATH/bin/python -m api.main