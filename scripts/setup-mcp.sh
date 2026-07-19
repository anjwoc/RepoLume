#!/usr/bin/env bash
# RepoLume v3 — 원터치 MCP 설정 스크립트
# 사용법: bash setup-mcp.sh

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
NC="\033[0m"

ok()   { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️ ${NC} $*"; }
info() { echo -e "ℹ️  $*"; }
fail() { echo -e "${RED}❌${NC} $*"; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║   RepoLume v3 — MCP 원터치 설정         ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 사전 조건 확인 ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📋 사전 조건 확인..."
command -v node   &>/dev/null && ok "Node.js $(node --version)" || fail "Node.js 미설치 (https://nodejs.org)"
command -v npm    &>/dev/null && ok "npm $(npm --version)"      || fail "npm 미설치"
command -v python3 &>/dev/null && ok "Python $(python3 --version)" || fail "Python3 미설치"
command -v go     &>/dev/null && ok "Go $(go version | awk '{print $3}')" || warn "Go 미설치 (Go 에이전트 빌드 불가)"
command -v docker &>/dev/null && ok "Docker $(docker --version | awk '{print $3}')" || warn "Docker 미설치 (GitHub MCP Docker 방식 불가)"
echo ""

# ─── Go 에이전트 빌드 ────────────────────────────────────────────────────────

echo "🔨 Go 에이전트 빌드..."
if command -v go &>/dev/null; then
    if [ -d "$SCRIPT_DIR/agent" ]; then
        pushd "$SCRIPT_DIR/agent" > /dev/null
        go build -o ../bin/repolume-agent ./cmd/repolume-agent/
        popd > /dev/null
        ok "repolume-agent 빌드 완료 → bin/repolume-agent"
        echo ""
        echo "  에이전트 상태:"
        "$SCRIPT_DIR/bin/repolume-agent" list | sed 's/^/    /'
    else
        warn "agent/ 디렉토리 없음 — 빌드 건너뜀"
    fi
else
    warn "Go 미설치 — 에이전트 빌드 건너뜀"
fi
echo ""

# ─── DBHub 설치 ──────────────────────────────────────────────────────────────

echo "🗄️  DBHub 설치 (PostgreSQL/MySQL/MSSQL/MariaDB 통합)..."
if npm install -g dbhub &>/dev/null 2>&1; then
    ok "DBHub 설치 완료"
else
    warn "DBHub 설치 실패 — 수동 설치: npm install -g dbhub"
fi

# ─── Claude Code 설치 ───────────────────────────────────────────────────────

echo ""
echo "🤖 Claude Code CLI 설치 (Anthropic Max 구독)..."
if npm install -g @anthropic-ai/claude-code &>/dev/null 2>&1; then
    ok "Claude Code 설치 완료"
    command -v claude &>/dev/null && ok "claude 명령어 확인: $(claude --version 2>/dev/null | head -1)"
else
    warn "Claude Code 설치 실패"
    info "수동 설치: npm install -g @anthropic-ai/claude-code"
    info "또는 Anthropic 구독 확인: https://claude.ai/download"
fi

# ─── mcp-atlassian 설치 (선택) ──────────────────────────────────────────────

echo ""
echo "📌 mcp-atlassian 설치 (Jira/Confluence, 선택사항)..."
if command -v uvx &>/dev/null; then
    ok "uvx 확인 완료 (mcp-atlassian 실행 가능)"
    info "사용 시: uvx mcp-atlassian --transport stdio"
elif command -v pip3 &>/dev/null; then
    if pip3 install mcp-atlassian --quiet 2>/dev/null; then
        ok "mcp-atlassian 설치 완료"
    else
        warn "mcp-atlassian 설치 실패"
    fi
else
    warn "pip3/uvx 없음 — mcp-atlassian 수동 설치 필요: pip install mcp-atlassian"
fi

# ─── GitHub MCP Docker 이미지 ───────────────────────────────────────────────

echo ""
echo "🐙 GitHub MCP 이미지 준비..."
if command -v docker &>/dev/null; then
    if docker pull ghcr.io/github/github-mcp-server --quiet 2>/dev/null; then
        ok "GitHub MCP Docker 이미지 준비 완료"
    else
        warn "Docker 이미지 pull 실패 — 나중에: docker pull ghcr.io/github/github-mcp-server"
    fi
else
    info "Docker 미설치 — GitHub MCP local(바이너리) 방식 또는 Docker 설치 후 재실행"
fi

# ─── 설정 파일 생성 ──────────────────────────────────────────────────────────

echo ""
echo "⚙️  설정 파일 생성..."
REPOLUME_DIR="$HOME/.repolume"
mkdir -p "$REPOLUME_DIR"

if [ ! -f "$REPOLUME_DIR/mcp-config.yaml" ]; then
    if [ -f "$SCRIPT_DIR/config/mcp-config.yaml.example" ]; then
        cp "$SCRIPT_DIR/config/mcp-config.yaml.example" "$REPOLUME_DIR/mcp-config.yaml"
        ok "설정 파일 생성: $REPOLUME_DIR/mcp-config.yaml"
    fi
else
    info "설정 파일 이미 존재: $REPOLUME_DIR/mcp-config.yaml"
fi

# ─── PATH 설정 안내 ──────────────────────────────────────────────────────────

BIN_DIR="$SCRIPT_DIR/bin"
echo ""
echo "📍 PATH 설정 (선택):"
echo "   export PATH=\"\$PATH:$BIN_DIR\""
echo "   # 또는 ~/.zshrc / ~/.bashrc에 위 줄 추가"

# ─── 완료 ────────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗"
echo    "║          ✅ 설정 완료!                   ║"
echo    "╠══════════════════════════════════════════╣"
echo    "║  다음 단계:                              ║"
echo    "║  1. MCP 활성화:                          ║"
echo    "║     vi ~/.repolume/mcp-config.yaml     ║"
echo    "║     enabled: true 설정                   ║"
echo    "║                                          ║"
echo    "║  2. 위키 생성:                            ║"
echo    "║     python -m cli.wiki generate ./repo   ║"
echo    "║       --agent gemini --lang ko           ║"
echo -e "╚══════════════════════════════════════════╝${NC}"
