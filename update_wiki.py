import json

cache_path = "/Users/jaecjeong/.adalflow/wikicache/localwiki_cache_local_local_affiliate_en_agy-gemini-3.5-flash-high.json"
with open(cache_path, "r", encoding="utf-8") as f:
    data = json.load(f)

markdown_content = """# Affiliate (제휴마케팅 플랫폼) 모듈 개요

이 문서는 Gmarket/Auction 제휴마케팅 도메인을 담당하는 `affiliate` 레포지토리의 전체 구조와 모듈별 역할에 대해 설명합니다.

## 시스템 구성도 (Architecture Overview)

전체 시스템은 크게 어드민 웹 애플리케이션(`affiliate-admin`), 백엔드 API 서비스(`affiliate-backend`), 그리고 백그라운드 배치 작업(`affiliate-batch`)의 3가지 주요 하위 프로젝트로 나뉩니다.

```mermaid
graph TD
    subgraph Client ["Client & Admin"]
        AdminWeb["Affiliate Admin Web<br>(Spring Boot)"]
    end

    subgraph Backend ["Backend APIs (affiliate-backend)"]
        AggrAPI["Aggregator API"]
        CoreAPI["Affiliate API"]
        PostbackAPI["Postback API"]
    end

    subgraph Batch ["Batch Jobs (affiliate-batch)"]
        LogBatch["Log Batch"]
        OrderBatch["Order Batch"]
        RetentionBatch["Retention Batch"]
    end

    subgraph External ["External Systems"]
        Hanbando["Hanbando Auth (한반도)"]
        ES["Elasticsearch"]
    end

    AdminWeb -->|"Auth & Menu Check"| Hanbando
    AdminWeb -->|"Data Request"| Backend
    Backend -->|"Index & Search"| ES
    Batch -->|"Background Processing"| Backend
```

## 하위 프로젝트 (Sub-projects) 상세

### 1. Affiliate Admin (`affiliate-admin`)
제휴마케팅 도메인에서 사용하는 Java / Spring Boot 기반의 어드민 웹 프로젝트입니다. 사내 표준 로그인 시스템인 "한반도(Hanbando)"와 연동되어 있습니다.

- **`affiliate-admin-web`**: 어드민 화면을 제공하는 프론트 컨트롤러 및 UI (JSP/Thymeleaf 등).
- **`affiliate-admin-api`**: 어드민 웹에서 내부적으로 사용하는 API 로직.
- **주요 특징**:
  - `hanauthapi` / `hancoreapi`를 활용하여 로그인 유효성 및 메뉴 권한 체크.
  - `@HanbandoAuthentication` 어노테이션을 통해 권한이 부여된 기능만 접근 통제.
  - 페이지 이동 시 로그인 세션 만료 여부를 체크하여 로그인 페이지 리다이렉트 또는 AJAX 오류 메시지 처리.

### 2. Affiliate Backend (`affiliate-backend`)
제휴마케팅 서비스의 핵심 비즈니스 로직과 API를 담당하는 백엔드 모듈 집합입니다. 도커 기반 컨테이너 배포 환경(`Dockerfile-*`, `docker-compose.yml`)이 구성되어 있습니다.

- **`affiliate-aggregator-api`**: 다양한 제휴사 또는 소스의 데이터를 집계하여 제공하는 API.
- **`affiliate-api`**: 제휴마케팅 코어 비즈니스 기능을 제공하는 메인 API.
- **`affiliate-postback-api`**: 외부 제휴 매체사(DSP 등)로 성과(전환/클릭 등)를 전송하거나 수신하는 포스트백 처리 API.
- **`affiliate-data`**: DB 엔티티, 리포지토리 및 공통 데이터 모델 모듈.
- **`affiliate-es-client`**: 검색 및 대용량 로그 조회를 위한 Elasticsearch 연동 클라이언트.

### 3. Affiliate Batch (`affiliate-batch`)
대용량 데이터 집계, 스케줄링 및 주기적 백그라운드 작업을 수행하는 배치 모듈입니다.

- **`affiliate-log-batch`**: 유입/클릭/로그 등 대량의 트래픽 데이터를 처리 및 적재.
- **`affiliate-order-batch`**: 제휴사를 통해 발생한 주문 데이터 수집 및 정산 데이터 가공.
- **`affiliate-retention-batch`**: 리텐션(재방문, 체류시간 등) 지표 분석 및 마트(Mart) 테이블 갱신 배치.

## 개발 가이드 및 팁
- **어드민 구축 시**: 기존 `.net` 환경 기반의 가이드에서 벗어나 Java Spring Boot로 신규 구축된 프레임워크를 사용합니다. `crypto-native library`를 사용하여 한반도 쿠키 암/복호화를 진행하며, M1/M2 맥북 개발자는 `5.4.1` 버전 이상의 라이브러리를 사용해야 합니다.
- **컨테이너 환경**: `affiliate-backend` 폴더에는 각 API별로 분리된 Dockerfile (`Dockerfile-aggr`, `Dockerfile-api`, `Dockerfile-postback`)이 제공되므로 마이크로서비스 형태로 관리할 수 있습니다.
"""

if "moduleOverview" in data.get("generated_pages", {}):
    data["generated_pages"]["moduleOverview"]["content"] = markdown_content
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Success: moduleOverview updated.")
else:
    print("Error: moduleOverview not found in generated_pages.")
