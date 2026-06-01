# MCP 통합 (MCP Integration)

## Overview

시스템은 다양한 외부 데이터 소스(데이터베이스, Atlassian, GitHub 등)로부터 컨텍스트를 수집하여 위키 문서를 보강하기 위해 **Model Context Protocol (MCP)**를 통합합니다. `MCPManager`를 통해 중앙 집중식으로 설정과 생명주기를 관리하며, 각 클라이언트는 독립적인 프로세스와 병렬로 통신하여 `SourcedContext`를 구성합니다.

## Architecture

MCP 통합 아키텍처는 중앙 관리자, 도메인별 클라이언트, 통신 계층(Base Client), 그리고 외부 서버 프로세스로 구성됩니다.

```mermaid
graph TD
    Config["mcp-config.yaml"] -.-> |load_config| Manager

    subgraph Core ["Orchestration"]
        Manager["MCPManager<br>(manager.py)"]
    end

    subgraph Clients ["Domain Clients"]
        DBClient["DatabaseMCPClient<br>(db_mcp.py)"]
        AtlassianClient["AtlassianMCPClient<br>(atlassian_mcp.py)"]
        GitHubClient["GitHubMCPClient<br>(github_mcp.py)"]
    end

    subgraph Protocol ["Communication Layer"]
        BaseClient["MCPStdioClient<br>(base_client.py)"]
    end

    subgraph Servers ["External MCP Servers"]
        DBHub["DBHub Process"]
        AtlassianServer["mcp-atlassian<br>Process"]
        GitHubServer["github-mcp-server<br>Process"]
    end

    Manager --> |collect_context| DBClient
    Manager --> |collect_context| AtlassianClient
    Manager --> |collect_context| GitHubClient

    DBClient --> BaseClient
    AtlassianClient --> BaseClient
    GitHubClient --> BaseClient

    BaseClient --> |"JSON-RPC 2.0<br>(stdin/stdout)"| DBHub
    BaseClient --> |"JSON-RPC 2.0<br>(stdin/stdout)"| AtlassianServer
    BaseClient --> |"JSON-RPC 2.0<br>(stdin/stdout)"| GitHubServer
```

### 병렬 컨텍스트 수집 (Parallel Context Collection)

여러 외부 시스템에서 데이터를 수집할 때 발생하는 지연을 최소화하기 위해 병렬 처리를 지원합니다.

```mermaid
graph TD
    Start["collect_context()"] --> ThreadPool["ThreadPoolExecutor<br>(max_workers=4)"]
    
    subgraph ParallelTasks ["Parallel Context Gathering"]
        TaskDB["get_schema_context()"]
        TaskGH["get_repo_context()"]
        TaskATL["get_project_context()"]
    end
    
    ThreadPool --> TaskDB
    ThreadPool --> TaskGH
    ThreadPool --> TaskATL
    
    TaskDB --> |Success / Timeout: 60s| Assembler["ContextAssembler"]
    TaskGH --> |Success / Timeout: 60s| Assembler
    TaskATL --> |Success / Timeout: 60s| Assembler
    
    Assembler --> Output["SourcedContext"]
```

## System Components

### 1. Central Orchestrator (`cli/mcp/manager.py`)

모든 MCP 클라이언트를 인스턴스화하고 병렬로 실행하여 최종 컨텍스트를 병합하는 역할을 수행합니다.

*   **설정 로드:** 기본 경로(`~/.localwiki/mcp-config.yaml`) 또는 사용자 지정 경로에서 설정을 파싱합니다. (`pyyaml` 활용)
*   **ContextAssembler:** `ThreadPoolExecutor`를 사용하여 최대 4개의 워커(`max_workers=4`)로 각 클라이언트의 컨텍스트를 수집합니다.
*   **상태 관리:** `status()` 및 `print_status()` 메서드를 통해 활성화된 MCP 소스의 상태를 확인하고 출력합니다.
*   **Timeouts:** 각 `Future` 태스크에 대해 60초의 timeout을 설정하여 무한 대기를 방지합니다.

### 2. Base Protocol Implementation (`cli/mcp/base_client.py`)

모든 MCP 통신의 기반이 되는 `MCPStdioClient` 클래스를 제공합니다. 서브프로세스의 표준 입출력(`stdio`)을 통해 통신합니다.

*   **JSON-RPC 2.0:** 요청(`request`), 응답(`response`), 알림(`notification`) 등 JSON-RPC 2.0 규격을 따릅니다.
*   **Protocol Version:** `2024-11-05` 버전을 명시하여 `initialize` Handshake를 수행합니다.
*   **Process Lifecycle:** `__enter__` 및 `__exit__` 매직 메서드를 통한 Context Manager 지원, `start()`와 `stop()`(Graceful shutdown 후 필요시 kill)을 담당합니다.
*   **Tool Execution:** `tools/list` 요청으로 사용 가능한 도구를 확인하고, `tools/call` 요청을 통해 도구를 실행하여 결과(`text` blocks)를 추출합니다.

### 3. GitHub MCP Client (`cli/mcp/github_mcp.py`)

코드 변경 이력 및 개발자의 의도(Intent)를 수집하여 위키 문서를 보강합니다.

*   **Modes:** 
    *   `docker`: 공식 Docker 이미지(`ghcr.io/github/github-mcp-server`)를 실행하여 격리된 환경에서 컨텍스트를 수집합니다.
    *   `local`: 로컬에 직접 컴파일된 `github-mcp-server` 바이너리를 실행합니다.
*   **Authentication:** `GITHUB_PERSONAL_ACCESS_TOKEN` 환경변수 또는 설정 파일의 `pat`를 사용합니다.
*   **Auto-Detection:** `detect_github_remote()` 함수가 로컬 `.git` 디렉터리의 `origin` URL을 분석하여 `owner`와 `repo`를 자동으로 추출합니다.
*   **Tools Used:** `list_pull_requests`, `search_issues`를 호출하여 PR 정보와 검색어(`topic`)와 관련된 이슈를 가져옵니다.
*   **Toolsets Filter:** `toolsets` 배열(`repos`, `issues`, `pull_requests`, `code_security`)을 통해 불필요한 도구 로드를 방지하여 LLM 컨텍스트 크기를 최적화합니다.

### 4. Atlassian MCP Client (`cli/mcp/atlassian_mcp.py`)

기획 문서 및 프로젝트 트래킹 이슈 컨텍스트를 통합하기 위해 Jira 및 Confluence 데이터를 수집합니다.

*   **Modes:**
    *   `cloud`: `uvx mcp-atlassian`을 `stdio` 기반으로 실행하되 `--cloud` 플래그를 사용하여 Atlassian Cloud의 OAuth 2.1 인증 방식을 활용합니다.
    *   `datacenter`: On-Premise 및 DataCenter 환경을 지원하며 `--jira-url`, `--confluence-url`, `--personal-token`(PAT)을 주입합니다.
*   **Tools Used:**
    *   `jira_search_issues`: 전달된 `topic`을 기반으로 JQL(`text ~ "topic" ORDER BY updated DESC`)을 구성하여 Jira 이슈 리스트(Summary, Status, Description, Priority)를 수집합니다.
    *   `confluence_search`: 특정 Space Key가 지정된 경우 해당 범위를 한정하여 Confluence 문서를 검색합니다.

## Deployment & Configuration (`config/mcp-config.yaml.example`)

시스템 설정은 YAML 포맷으로 관리되며 각 도메인별 세분화된 스펙을 제공합니다. 사용자는 각 항목의 `enabled: true` 변경을 통해 통합을 제어할 수 있습니다.

```yaml
# ~/.localwiki/mcp-config.yaml 예시

databases:
  postgresql:
    enabled: true
    connection_string: "postgresql://user:password@localhost:5432/mydb"
    display_name: "PostgreSQL"

atlassian:
  enabled: true
  mode: "cloud" # "cloud" | "datacenter"
  cloud:
    mcp_url: "https://mcp.atlassian.com/v1/sse"
  jira_project: "PROJ"
  space_key: "ENG"

github:
  enabled: true
  mode: "docker" # "docker" | "local"
  docker:
    image: "ghcr.io/github/github-mcp-server"
  local:
    token: "${GITHUB_PERSONAL_ACCESS_TOKEN}"
  toolsets:
    - repos
    - issues
    - pull_requests
