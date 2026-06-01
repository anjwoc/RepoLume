# MCP Integration (엠씨피 통합)

## Introduction
Model Context Protocol(MCP)은 AI 모델이 외부 도구, 데이터 소스 및 서비스와 안전하고 표준화된 방식으로 상호작용할 수 있도록 지원하는 개방형 프로토콜입니다. 본 시스템은 다양한 외부 엔드포인트(GitHub, 데이터베이스, Atlassian 등)와의 유연하고 확장 가능한 연동을 위해 MCP 클라이언트 아키텍처를 도입하였습니다. 

본 위키 페이지는 시스템 내 MCP 통합 컴포넌트의 구조, 핵심 클래스, 데이터 흐름 및 구성 방법을 상세히 설명합니다.

---

## Architecture Overview
시스템의 MCP 통합 레이어는 클라이언트 인터페이스의 표준화를 정의하는 **Base Client**, 개별 외부 서비스와 통신하는 **Specific Clients**, 그리고 이들의 라이프사이클과 라우팅을 관리하는 **MCP Manager**로 구성됩니다.

```mermaid
graph TD
    subgraph CLI ["CLI Layer"]
        Manager["MCPManager<br>(cli/mcp/manager.py)"]
    end

    subgraph Clients ["MCP Clients Layer"]
        Base["BaseMCPClient<br>(cli/mcp/base_client.py)"]
        GitHub["GitHubMCPClient<br>(cli/mcp/github_mcp.py)"]
        DB["DatabaseMCPClient<br>(cli/mcp/db_mcp.py)"]
        Atlassian["AtlassianMCPClient<br>(cli/mcp/atlassian_mcp.py)"]
    end

    subgraph External ["External Endpoints"]
        GH_API["GitHub API"]
        DB_Engine["Target Database"]
        ATL_API["Atlassian API / Jira / Confluence"]
    end

    Manager --> |Instantiates & Orchestrates| Base
    Base --> GitHub
    Base --> DB
    Base --> Atlassian

    GitHub --> |REST & GraphQL API| GH_API
    DB --> |SQL Connection| DB_Engine
    Atlassian --> |Jira / Confluence REST API| ATL_API
```

---

## Core Components and Source Files

### 1. MCP Manager
* **Source File:** `cli/mcp/manager.py`
* **Overview:** 
  `MCPManager` 클래스는 전체 MCP 시스템의 진입점(Entrypoint) 역할을 수행합니다. 설정 파일로부터 각 MCP 서버의 설정을 로드하고, 클라이언트 인스턴스를 생성하며, 에이전트로부터 전달된 도구 호출(Tool Call) 요청을 올바른 클라이언트로 라우팅하는 오케스트레이터입니다.
* **Key Functions:**
  * `load_config(config_path: str)`: MCP 설정 파일을 파싱하여 활성화할 클라이언트와 자격 증명(Credentials) 정보를 메모리에 로드합니다.
  * `initialize_clients()`: 설정된 세션 및 엔드포인트 정보를 바탕으로 GitHub, DB, Atlassian 등 각각의 MCP 클라이언트를 인스턴스화하고 연결을 초기화합니다.
  * `execute_tool(client_name: str, tool_name: str, arguments: dict) -> dict`: 특정 클라이언트에 대해 도구 실행을 요청하고 결과를 반환합니다.
  * `shutdown()`: 활성화된 모든 클라이언트 세션을 안전하게 종료하고 리소스를 해제합니다.

### 2. Base Client
* **Source File:** `cli/mcp/base_client.py`
* **Overview:** 
  모든 구체적(Concrete) MCP 클라이언트가 구현해야 하는 공통 인터페이스와 인프라 로직을 정의하는 추상 베이스 클래스인 `BaseMCPClient`를 포함합니다.
* **Key Functions & Interfaces:**
  * `connect()`: 외부 MCP 서버 또는 API 엔드포인트와의 세션을 설정하는 추상 메서드입니다.
  * `list_tools() -> list`: 클라이언트가 지원하는 도구의 목록 및 각 도구의 파라미터 스키마를 반환합니다.
  * `call_tool(name: str, arguments: dict) -> dict`: 지정된 도구를 실행하는 핵심 실행 메서드입니다.
  * `disconnect()`: 세션을 종료하고 네트워크 커넥션을 정리합니다.

### 3. GitHub MCP Client
* **Source File:** `cli/mcp/github_mcp.py`
* **Overview:** 
  GitHub API(v3 REST 및 v4 GraphQL)와의 연동을 전담하는 `GitHubMCPClient` 클래스입니다. 코드 저장소 브라우징, 이슈 및 Pull Request 생성/조회, 커밋 및 트리 조회 등의 도구를 제공합니다.
* **Key Features:**
  * Personal Access Token(PAT) 기반 인증을 수행합니다.
  * 저장소 정보 조회, 코드 검색, 파일 내용 조회, 이슈 관리 등의 특화된 MCP Tool 세트를 노출합니다.

### 4. Database MCP Client
* **Source File:** `cli/mcp/db_mcp.py`
* **Overview:** 
  관계형 데이터베이스(RDBMS) 또는 NoSQL 데이터베이스와의 연결을 맺고, 구조 진단 및 데이터 질의를 지원하는 `DatabaseMCPClient` 클래스입니다.
* **Key Features:**
  * Connection Pool을 관리하고 데이터베이스 드라이버를 로드합니다.
  * 스키마 메타데이터 분석(Table, Column, Index 구조 확인), 안전한 SELECT 쿼리 실행, 실행 계획(Explain Plan) 확인 도구를 제공합니다.
  * SQL Injection 방지를 위한 매개변수화된 쿼리 검증 로직이 포함되어 있습니다.

### 5. Atlassian MCP Client
* **Source File:** `cli/mcp/atlassian_mcp.py`
* **Overview:** 
  Jira 및 Confluence와 같은 Atlassian 제품군과의 통합을 지원하는 `AtlassianMCPClient` 클래스입니다. 협업 툴에 기록된 티켓 정보나 문서를 모델에 컨텍스트로 제공할 수 있도록 돕습니다.
* **Key Features:**
  * Jira Issue 생성, 상태 전환(Transition), 댓글 작성 및 검색(JQL 지원) 도구를 제공합니다.
  * Confluence Space 및 Page의 생성, 업데이트, HTML 문서 파싱 및 마크다운 변환 기능을 지원합니다.

---

## Tool Execution Flow
에이전트가 특정 태스크를 수행하기 위해 도구를 호출할 때 발생하는 내부 시퀀스는 다음과 같습니다.

```mermaid
sequenceDiagram
    autonumber
    participant Agent as AI Agent
    participant Mgr as MCPManager
    participant Client as Specific MCP Client
    participant API as External Endpoint (GitHub/DB/etc.)

    Agent->>Mgr: execute_tool(client_name, tool_name, arguments)
    Note over Mgr: 클라이언트 매핑 정보 검증
    Mgr->>Client: call_tool(tool_name, arguments)
    Note over Client: 아규먼트 유효성 검증 & 페이로드 생성
    Client->>API: HTTP Request / SQL Query
    API-->>Client: Response Data / Result Set
    Note over Client: 결과를 MCP 표준 Output 포맷으로 변환
    Client-->>Mgr: ToolResponse
    Mgr-->>Agent: Formatted Text / JSON Content
```

---

## Deployment & Configuration
MCP 컴포넌트들을 활성화하고 제어하기 위해 시스템은 중앙 집중식 JSON 설정을 채택하고 있습니다.

### Configuration File (`mcp_config.json`)
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_***"
      }
    },
    "database": {
      "enabled": true,
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/mydb"
      }
    },
    "atlassian": {
      "enabled": false,
      "env": {
        "ATLASSIAN_URL": "https://your-domain.atlassian.net",
        "ATLASSIAN_USER_EMAIL": "user@domain.com",
        "ATLASSIAN_API_TOKEN": "atk_***"
      }
    }
  }
}
```

### Environment Variables
설정 파일에 민감한 정보(API Token, Password 등)를 직접 하드코딩하지 않고, `mcp_config.json`에서 참조하는 환경 변수를 프로세스 구동 시 주입하는 방식을 권장합니다.
* `GITHUB_PERSONAL_ACCESS_TOKEN`: GitHub API 인증용
* `DATABASE_URL`: 대상 데이터베이스 접속 URI
* `ATLASSIAN_API_TOKEN`: Jira/Confluence API Basic Auth용 토큰
