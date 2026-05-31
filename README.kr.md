# LocalWiki

LocalWiki는 코드 저장소를 분석해 로컬 우선 위키를 생성하는 도구입니다. 저장소 구조를 읽고, 위키 목차를 기획하고, Markdown 문서를 생성하며, Mermaid 다이어그램과 RAG 기반 질의응답을 제공합니다.

핵심 포지션은 "사내 코드가 외부 인덱싱 서비스로 나가지 않는 로컬/셀프호스트 코드 위키"입니다.

## 주요 기능

- 로컬 경로와 Git URL 기반 저장소 분석
- Next.js 기반 대화형 위키 뷰어
- FastAPI 기반 생성/캐시/스트리밍/RAG API
- CLI 기반 헤드리스 위키 생성 및 Confluence 게시
- Gemini, OpenAI, Claude, OpenRouter, Bedrock, Azure OpenAI, Ollama, LiteLLM 지원
- 정적 분석과 그래프 컨텍스트를 이용한 아키텍처 요약 및 Mermaid 다이어그램
- GitHub, Jira/Confluence, DB용 MCP 컨텍스트 연결
- 생성 문서별 소스 출처 블록

## Docker Compose 빠른 시작

```bash
cp .env.example .env
```

`.env`에 사용할 모델 provider의 API 키를 넣습니다. RAG/임베딩까지 안정적으로 쓰려면 `OPENAI_API_KEY` 또는 `GOOGLE_API_KEY` 설정을 권장합니다.

```bash
docker compose up --build
```

접속 주소:

- Web UI: `http://localhost:3000`
- API: `http://localhost:8001`
- Health check: `http://localhost:8001/health`

## 로컬 개발

```bash
pnpm install
python3 -m pip install poetry==2.0.1
poetry install -C api
python3 -m api.main
```

다른 터미널에서:

```bash
pnpm dev
```

## CLI 사용

로컬 저장소 위키 생성:

```bash
python3 -m cli.wiki generate /path/to/repo --provider gemini --lang ko --output ./wiki-out/my-repo
```

Git URL 위키 생성:

```bash
python3 -m cli.wiki generate https://github.com/owner/repo --provider openai --lang en
```

API 키 대신 CLI 구독 도구 사용:

```bash
python3 -m cli.wiki generate ./my-repo --agent codex --lang ko
```

Confluence 게시:

```bash
python3 -m cli.wiki publish ./wiki-out/my-repo \
  --url https://your-domain.atlassian.net/wiki \
  --space ENG \
  --username you@example.com \
  --token "$ATLASSIAN_API_TOKEN" \
  --root-title "My Repo Wiki"
```

## 문서

- Docker 운영: [docs/docker.md](docs/docker.md)
- 환경 설정: [docs/configuration.md](docs/configuration.md)
- 아키텍처: [docs/architecture.md](docs/architecture.md)
- 생성 흐름: [docs/workflow.md](docs/workflow.md)
- 오픈소스 고지: [docs/open-source.md](docs/open-source.md)

## 오픈소스 고지

LocalWiki Sonar 정적 분석 레이어에는 MIT 라이선스 프로젝트에서 일부 아이디어와 코드가 이식된 부분이 있습니다. 공개 제품 문서에서는 내부 분석 레이어 이름을 사용하고, 법적/출처 표기는 `NOTICE`와 각 소스 파일 헤더에만 둡니다.

배포 시 `LICENSE`와 `NOTICE`를 함께 포함하세요.

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
