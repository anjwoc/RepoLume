# Technical Wiki: Data Pipeline

## Overview
이 문서는 시스템의 대용량 데이터 처리 및 흐름 제어를 담당하는 데이터 파이프라인 모듈에 대한 기술 아키텍처 및 구현 가이드입니다. 본 아키텍처는 [api/data_pipeline.py](file:///Users/jcjeong/.gemini/antigravity-cli/scratch/api/data_pipeline.py)에 정의된 클래스와 인터페이스를 기반으로 설계되었습니다.

본 모듈은 다양한 데이터 소스로부터 대규모 데이터를 효율적으로 수집(Ingestion), 변환(Transformation), 그리고 저장소에 적재(Loading)하는 ETL 파이프라인 아키텍처를 제공합니다.

---

## Architecture & Design
시스템은 컴포넌트 간 결합도를 낮추고 확장성을 극대화하기 위해 Layered Architecture 패턴을 따릅니다. 각 단계(Layer)는 독립된 인터페이스로 추상화되어 있으며, `PipelineController`가 전체 데이터의 흐름 및 생명주기를 제어합니다.

```mermaid
graph LR
    subgraph IngestionLayer ["Ingestion Layer"]
        DS1["FileDataSource"]
        DS2["APIDataSource"]
    end

    subgraph ProcessingLayer ["Processing Layer"]
        DT1["CleanTransformer"]
        DT2["FilterTransformer"]
    end

    subgraph StorageLayer ["Storage Layer"]
        DK1["DatabaseSink"]
        DK2["S3Sink"]
    end

    subgraph Orchestration ["Orchestration & Control"]
        PC["PipelineController"]
    end

    PC --> IngestionLayer
    IngestionLayer --> ProcessingLayer
    ProcessingLayer --> StorageLayer
```

---

## Key Components
모든 핵심 컴포넌트는 [api/data_pipeline.py](file:///Users/jcjeong/.gemini/antigravity-cli/scratch/api/data_pipeline.py) 소스 코드에 추상 클래스 및 실체화 클래스로 구현되어 있습니다.

### 1. DataSource (Ingestion)
외부 인프라 및 시스템으로부터 원시 데이터(Raw Data)를 획득하는 역할을 담당합니다.
* **`DataSource` (Abstract Base Class)**: 모든 데이터 소스 클래스의 최상위 추상 클래스로, `read()` 추상 메소드를 정의합니다.
* **`FileDataSource`**: 로컬 혹은 네트워크 파일 시스템에서 데이터를 스트리밍 혹은 배치 형태로 읽어옵니다.
* **`APIDataSource`**: 외부 REST API 엔드포인트를 호출하여 JSON/XML 포맷의 데이터를 수집합니다.

### 2. DataTransformer (Processing)
수집된 데이터를 비즈니스 요구사항에 맞게 정제 및 변환합니다.
* **`DataTransformer` (Abstract Base Class)**: 데이터 변환을 위한 인터페이스로, `transform()` 추상 메소드를 제공합니다.
* **`CleanTransformer`**: 결측치(Null Value) 처리, 데이터 타입 캐스팅, 문자열 포맷팅 등 정제 작업을 담당합니다.
* **`FilterTransformer`**: 특정 조건에 맞는 데이터만 필터링하여 불필요한 페이로드를 줄입니다.

### 3. DataSink (Storage)
가공이 완료된 데이터를 최종 저장소에 영구 적재합니다.
* **`DataSink` (Abstract Base Class)**: 데이터를 외부 스토리지에 쓰기 위한 규격인 `write()` 메소드를 정의합니다.
* **`DatabaseSink`**: RDBMS 또는 NoSQL 데이터베이스에 연결하여 데이터를 트랜잭션 단위로 `INSERT`/`UPSERT` 합니다.
* **`S3Sink`**: 대용량 배치 결과 파일을 Object Storage(AWS S3 등)에 업로드합니다.

### 4. PipelineController (Orchestration)
ETL 흐름 제어 및 오류 모니터링을 담당하는 오케스트레이터 인터페이스입니다.
* **`PipelineController`**: `DataSource`, `DataTransformer`, `DataSink` 객체를 생성자 주입(Dependency Injection) 방식으로 인스턴스화하여 흐름을 통제합니다.
* 주요 변수:
  * `batch_size`: 한 번의 배치 트랜잭션에서 처리할 데이터 레코드 수 제한
  * `max_retry`: 실패 시 재시도 횟수

---

## Data Flow & Sequence
전체 데이터 파이프라인의 런타임 데이터 흐름은 다음과 같은 시퀀스로 진행됩니다.

```mermaid
sequenceDiagram
    autonumber
    participant App as Client Application
    participant PC as PipelineController
    participant DS as DataSource
    participant DT as DataTransformer
    participant DK as DataSink

    App->>PC: run()
    activate PC
    PC->>DS: read()
    activate DS
    DS-->>PC: Raw Data Stream
    deactivate DS

    PC->>DT: transform(Raw Data)
    activate DT
    DT-->>PC: Transformed Data
    deactivate DT

    PC->>DK: write(Transformed Data)
    activate DK
    DK-->>PC: Storage Write Success
    deactivate DK
    
    PC-->>App: Execution Report (Success/Fail)
    deactivate PC
```

---

## Error Handling & Reliability
분산 환경에서 데이터 유실 및 파이프라인 중단을 방지하기 위해 다음과 같은 내결함성(Fault Tolerance) 메커니즘을 적용하고 있습니다.

* **Retry Mechanism**: 네트워크 순시 장애에 대비하여 `APIDataSource` 호출 실패 시 지수 백오프(Exponential Backoff) 기반의 재시도 로직이 동작합니다.
* **Dead Letter Queue (DLQ)**: `transform()` 프로세스 진행 중 데이터 스키마 불일치로 실패한 레코드는 파이프라인 전체를 중단시키지 않고 DLQ 저장소로 우회 적재됩니다.
* **Transaction Rollback**: `DatabaseSink` 작업 중 예외가 발생할 경우 해당 배치 배치셋(Batch Set) 전체에 대해 `ROLLBACK` 처리를 수행하여 데이터 일관성(Consistency)을 유지합니다.

---

## Deployment & Configuration
파이프라인 컴포넌트의 환경 설정 변수는 YAML 파일 형태의 `PipelineConfig`를 통해 관리됩니다.

```yaml
# pipeline_config.yaml
pipeline:
  name: "daily_user_activity_pipeline"
  batch_size: 1000
  max_retry: 3
  source:
    type: "API"
    endpoint: "https://api.internal/v1/activities"
  sink:
    type: "Database"
    connection_string: "postgresql://user:password@localhost:5432/analytics"
```

각 컴포넌트는 `pipeline_config.yaml` 파일의 설정을 실시간 로드하여 런타임 동작을 초기화합니다. 추가 정보 및 구체적인 소스 코드는 [api/data_pipeline.py](file:///Users/jcjeong/.gemini/antigravity-cli/scratch/api/data_pipeline.py)를 참조해 주시기 바랍니다.
