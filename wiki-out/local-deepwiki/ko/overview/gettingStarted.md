이 프로젝트는 LLM 기반의 로컬 저장소 위키 생성 도구인 **Local DeepWiki**의 "시작하기" 가이드입니다. 제공된 `README.md` 파일을 기반으로 작성되었습니다.

### Prerequisites

이 도구를 사용하기 전에 다음 구성 요소들이 설치되어 있어야 합니다.

1.  **Git:** 소스 코드 관리 및 버전 관리 도구. 저장소를 클론하고 코드를 관리하기 위해 필수입니다.
2.  **Docker:** 컨테이너화 플랫폼. 백엔드 서비스(예: PostgreSQL, Redis 등) 및 기타 필요한 의존성 서비스를 일관된 환경에서 실행하기 위해 사용됩니다.
3.  **Python 3.12+:** 프로젝트 백엔드 (API 및 데이터 파이프라인)의 주 실행 환경입니다. Python 3.12 이상의 버전이 권장됩니다. 의존성 관리를 위해 `uv` 사용을 고려할 수 있습니다 (로컬 실행 시).
4.  **Node.js 22.x+:** 프로젝트 프론트엔드 (웹 UI)의 실행 환경입니다. 22.x 버전 이상이 필요합니다. 패키지 관리를 위해 `pnpm`을 사용합니다.
5.  *(Optional)* **Ollama:** 로컬 환경에서 LLM(Large Language Model) 모델을 실행하고 관리하기 위한 도구입니다. 클라우드 기반 API(예: OpenAI, Anthropic) 대신 로컬 모델을 사용하여 오프라인 또는 프라이버시가 중요한 환경에서 로컬 모델을 활용할 때 유용합니다.

---

### Installation & Setup

Local DeepWiki를 로컬 환경에 설치하고 설정하는 과정은 두 가지 주요 단계로 나뉩니다. 첫 번째는 저장소를 클론하고 백엔드 서버(API)를 실행하는 것이고, 두 번째는 프론트엔드 UI 컴포넌트를 설정하고 실행하는 것입니다.

#### 1. Repository Setup & Backend (Python API)

백엔드 API는 Python으로 구축되어 있으며, 위키 생성 로직, 데이터베이스 연동, LLM 인터페이스를 담당합니다. 다음 단계를 통해 설정합니다.

1.  **저장소 클론 및 디렉토리 이동:**
    우선 터미널을 열고 Git을 사용하여 프로젝트 저장소를 로컬 머신에 복제합니다. 그런 다음 프로젝트 루트 디렉토리로 이동합니다.
    ```bash
    git clone https://github.com/your-username/local-deepwiki.git
    cd local-deepwiki
    ```

2.  **API 디렉토리 이동:**
    백엔드 설정은 `api` 서브 디렉토리에서 진행됩니다.
    ```bash
    cd api
    ```

3.  **환경 변수 설정:**
    시스템 구성에 필요한 환경 변수를 설정합니다. `api` 디렉토리에 있는 `.env.example` 파일을 복사하여 실제 환경 변수를 저장할 `.env` 파일을 생성합니다.
    ```bash
    cp .env.example .env
    ```
    생성된 `.env` 파일을 열고 사용하려는 LLM 제공자의 API Key(예: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) 또는 Ollama 서버 URL과 같은 필요한 설정 값을 입력합니다.

4.  **Python 의존성 설치:**
    프로젝트에 필요한 Python 패키지를 설치합니다. 의존성 관리 및 가상 환경 생성 도구인 `uv`를 사용하면 설치 속도가 매우 빠르고 관리가 편리합니다. `uv`가 없다면 `pip`와 `venv`를 사용할 수 있습니다. 여기서는 `uv`를 사용한 설치 방법을 안내합니다. (명령어 실행 전 가상 환경 활성화 권장)
    ```bash
    uv sync
    # 또는
    # uv pip install -r requirements.txt (requirements.txt가 존재하는 경우)
    ```

5.  **백엔드 API 서버 실행:**
    설치가 완료되면 개발용 서버를 시작합니다. 기본적으로 포트 `8000`에서 실행되며, 백그라운드 작업 스케줄링 등의 기능을 제공합니다.
    ```bash
    uvicorn main:app --reload --port 8000
    ```
    이제 API 서버가 백그라운드에서 정상적으로 구동됩니다.

#### 2. Frontend Setup (Next.js / Node.js)

프론트엔드는 사용자가 시스템과 상호작용하는 웹 기반 UI를 제공하며 Next.js 프레임워크를 기반으로 합니다. 프로젝트 루트 디렉토리로 이동하여 프론트엔드 설정을 진행합니다.

1.  **루트 디렉토리 이동:**
    새로운 터미널 창을 열거나, 기존 터미널에서 백엔드 서버를 백그라운드로 돌린 후 프로젝트의 최상위 디렉토리로 이동합니다. (현재 `api` 디렉토리라면 `cd ..` 실행)

2.  **Node 의존성 설치:**
    Node.js 패키지 매니저인 `pnpm`을 사용하여 프론트엔드 구동에 필요한 라이브러리 및 컴포넌트를 설치합니다. (만약 `pnpm`이 없다면 `npm install -g pnpm`으로 전역 설치 후 진행)
    ```bash
    pnpm install
    ```

3.  **개발 서버 실행:**
    의존성 설치가 완료되면 프론트엔드 개발 서버를 시작합니다. 이는 로컬 환경에서 수정 사항을 실시간으로 확인하며 개발할 수 있게 해줍니다.
    ```bash
    pnpm dev
    ```

서버가 성공적으로 시작되면 웹 브라우저를 열고 `http://localhost:3000` 주소로 접속하여 **Local DeepWiki Dashboard**에 접근할 수 있습니다.

---

### Docker Deployment

위의 로컬 설정 과정이 복잡하게 느껴지거나 모든 구성 요소를 일관된 환경에서 한 번에 실행하고 싶다면, Docker Compose를 활용한 컨테이너 기반 배포를 권장합니다. 이는 시스템 구성 요소 간의 의존성 충돌을 방지하고 배포 과정을 크게 단순화합니다.

Docker Compose는 다음과 같은 서비스를 단일 명령어로 오케스트레이션하여 실행합니다:
*   **Web UI (Frontend):** 사용자 인터페이스
*   **API Server (Backend):** 핵심 로직 및 API 엔드포인트
*   **LiteLLM (Optional/Proxy):** 다양한 LLM 제공자를 단일 인터페이스로 관리하기 위한 프록시 서버. 로컬 모델과 클라우드 모델 간의 유연한 전환을 돕습니다.
*   **Ollama (Optional):** 로컬 모델 실행을 위한 컨테이너 (로컬 모델을 사용하는 경우에만 필요).

**실행 방법:**

프로젝트 루트 디렉토리에서 다음 명령어를 실행합니다. `docker-compose.yml` 파일에 정의된 구성에 따라 필요한 모든 서비스가 백그라운드에서 빌드되고 시작됩니다.

```bash
docker-compose up -d --build
```

**접속 정보:**

Docker 컨테이너가 정상적으로 구동된 후에는 브라우저를 통해 각 서비스에 접근할 수 있습니다.

*   **웹 대시보드 접근 (UI):** 웹 브라우저에서 `http://localhost:3000`으로 접속하여 인터페이스를 사용합니다.
*   **API 엔드포인트 접근:** 시스템 연동 또는 직접적인 API 호출을 위해서는 `http://localhost:8000`을 사용합니다. Swagger UI 기반의 API 문서는 `http://localhost:8000/docs`에서 확인할 수 있습니다.

---

### Setup Architecture Overview

다음은 **Local DeepWiki**의 주요 구성 요소들이 설치되고 상호작용하는 구조를 보여주는 다이어그램입니다. 백엔드와 프론트엔드가 분리된 구조를 가지며, 사용자의 선택에 따라 로컬 또는 클라우드 LLM과 연결됩니다.

```mermaid
graph TD
    %% 외부 연결 포인트
    User["사용자 (Web Browser)"]

    subgraph Frontend ["Frontend Environment (Node.js 22.x+)"]
        NextJS["Next.js Web UI<br>(localhost:3000)"]
    end

    subgraph Backend ["Backend Environment (Python 3.12+)"]
        FastAPI["FastAPI Server<br>(localhost:8000)"]
        DataPipeline["Data Pipeline &<br>Wiki Generator"]
        VectorDB[("Vector DB<br>(Optional/TBD)")]
    end

    subgraph LLM_Providers ["LLM Providers"]
        direction TB
        CloudLLM["Cloud LLM<br>(OpenAI, Anthropic 등)"]
        LocalLLM["Local LLM<br>(Ollama)"]
        LiteLLM["LiteLLM Proxy<br>(Optional)"]
    end

    %% 연결 관계 정의
    User -->|"HTTP Request"| NextJS
    NextJS -->|"REST API Calls"| FastAPI
    FastAPI --> DataPipeline
    FastAPI -.->|"Data Storage"| VectorDB
    
    DataPipeline -->|"API Calls (Direct)"| CloudLLM
    DataPipeline -->|"API Calls (Direct)"| LocalLLM
    DataPipeline -.->|"API Calls (via Proxy)"| LiteLLM
    
    LiteLLM -.-> CloudLLM
    LiteLLM -.-> LocalLLM
