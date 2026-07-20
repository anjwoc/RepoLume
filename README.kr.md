# RepoLume

RepoLume는 코드 저장소를 분석해 로컬 우선 위키를 생성하는 도구입니다. 저장소 구조를 읽고, 승인할 위키 목차를 제안한 뒤 Markdown 문서와 Mermaid 다이어그램을 생성합니다.

핵심 포지션은 "사내 코드가 외부 인덱싱 서비스로 나가지 않는 로컬/셀프호스트 코드 위키"입니다.

## 주요 기능

- 로컬 경로와 Git URL 기반 저장소 분석
- Next.js 기반 대화형 위키 뷰어
- FastAPI 기반 위키 생성·캐시·진행 로그 스트리밍
- CLI 기반 헤드리스 위키 생성 및 Confluence 게시
- Gemini, OpenAI, Claude, OpenRouter, Bedrock, Azure OpenAI, Ollama, LiteLLM 지원
- 정적 분석과 그래프 컨텍스트를 이용한 아키텍처 요약 및 Mermaid 다이어그램
- GitHub, Jira/Confluence, DB용 MCP 컨텍스트 연결
- 생성 문서별 소스 출처 블록

## 시작하기

사용 방식에 맞는 경로를 선택합니다.

- **설치형 데스크톱 앱:** GitHub Release에 첨부된 `.dmg` 또는 `.exe`를 설치합니다. Node.js, Python, Poetry, Go는 필요하지 않습니다.
- **Docker Compose:** 셀프호스팅을 위한 가장 짧고 재현 가능한 경로입니다.
- **소스 체크아웃:** 기여자와 커스텀 빌드용입니다.

### Docker Compose

```bash
cp .env.example .env
```

`.env`에 위키 생성에 사용할 모델 provider의 API 키를 넣습니다.

```bash
docker compose up --build
```

접속 주소:

- Web UI: `http://localhost:3000`
- API: `http://localhost:8001`
- Health check: `http://localhost:8001/health`

백엔드 준비 상태를 확인합니다.

```bash
curl http://localhost:8001/health
```

이후 `http://localhost:3000`을 열고 저장소 폴더를 선택한 다음, 폴더 권한을 허용하고 모델을 선택해 분석을 시작합니다.

## 로컬 개발

새로 클론을 받은 후, 아래 명령어로 모든 의존성(프론트엔드 및 파이썬 API 서버)을 한 번에 설치할 수 있습니다:

```bash
pnpm run setup
```

설치가 완료되면 아래 명령어 하나로 **프론트엔드, API 서버, 에이전트**를 모두 한 번에 실행합니다:

```bash
pnpm run dev:all
```

> **참고:** Go 에이전트는 `dev:all` 실행 시 자동으로 컴파일되어 `bin/repolume-agent` 위치에 생성됩니다.

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


## 데스크톱 배포 빌드

아래 단일 명령을 사용합니다.

```bash
npm run release:desktop
```

명령을 실행할 때마다 기존 `dist/`와 과거 `dist-electron*` 디렉터리를 제거하고, 현재 버전의 설치 파일만 `dist/`에 새로 생성합니다. 설치 파일은 Git에 커밋하지 않고 GitHub Release에 첨부합니다.

## 오픈소스 고지

RepoLume Sonar 정적 분석 레이어에는 MIT 라이선스 프로젝트에서 일부 아이디어와 코드가 이식된 부분이 있습니다. 공개 제품 문서에서는 내부 분석 레이어 이름을 사용하고, 법적/출처 표기는 `NOTICE`와 각 소스 파일 헤더에만 둡니다.

배포 시 `LICENSE`와 `NOTICE`를 함께 포함하세요.

## 라이선스

MIT. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
