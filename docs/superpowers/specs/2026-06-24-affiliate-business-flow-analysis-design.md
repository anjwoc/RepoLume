# Affiliate 비즈니스 플로우 분석 시스템 설계

**작성일:** 2026-06-24  
**대상 레포:** `~/work/martech/affiliate` (6개 서브 레포)  
**레퍼런스 산출물:** `Linkrew_Messaging_Business_Flow.md`  
**설계 범위:** 비즈니스 플로우 추출 · 상세 분석 · 산출물 생성 시스템

---

## 1. 배경 및 문제 정의

### 1.1 목표 산출물 수준 (레퍼런스 기준)

`Linkrew_Messaging_Business_Flow.md`가 정의하는 품질 기준:

| 항목 | 기준 |
|---|---|
| 문서 단위 | 플로우 1개 = 파일 1개 |
| DB 추적 | 실제 SQL (SELECT/INSERT/UPDATE), 테이블명, 컬럼명, 조건값 |
| ERD | FK 관계 다이어그램 |
| 컴포넌트 체인 | 파일경로 + 라인번호 + 상태 표 (numbered) |
| 코드 레퍼런스 | 실제 클래스명 + 메서드명 + 라인번호 |
| Mermaid | sequenceDiagram with DB participants |

### 1.2 현재 `system_analysis/business_flow.md` 갭

| 항목 | 현재 | 목표 |
|---|---|---|
| 문서 단위 | 전체 시스템 단일 파일 | 플로우별 개별 파일 |
| DB 추적 | 테이블명 언급 수준 | 실제 SQL 쿼리 포함 |
| ERD | 없음 | FK 관계 다이어그램 |
| 컴포넌트 체인 표 | 없음 | numbered 완성도 표 |
| MCP 활용 | 없음 | devdb/oracle/github MCP 연결 |

### 1.3 원인 분석

1. **wiki-generator.ts `multi-project` 템플릿:** "ONE PAGE PER flow" 명시하나 실제로는 단일 flat 파일 생성
2. **MCP 미연결:** devdb/oracle MCP가 생성 파이프라인에 없어 LLM이 코드에서 SQL을 추론 → generic output
3. **컨텍스트 부족:** codegraph call chain 없이 파일 트리 수준 분석만 수행
4. **섹션 강제 없음:** DB-level SQL trace가 required section으로 강제되지 않음

---

## 2. 비즈니스 플로우 카탈로그

6개 레포에서 식별된 전체 플로우 (총 19개).

### 2.1 어필리에이트 코어 — 링크/유입/전환 (7개)

| # | 플로우 | 진입점 | 주요 레포 | 핵심 DB |
|---|---|---|---|---|
| F01 | 파트너 가입 & 온보딩 | `affiliate-web` SignUp UI | frontend → backend/api → admin | `LINKREW_MEMB_INFO`, `LINKREW_BUSINESS` |
| F02 | 쇼트링크 발급 | `POST /v1/short-url` | gateway → backend/api | `AFFILIATE_SHORT_URL`, Redis |
| F03 | 유입(클릭) 처리 | `GET /{shortCode}` redirect | gateway → backend/api | MongoDB (inflow log), Redis |
| F04 | 주문 어트리뷰션 | Kafka `bz_carbon_order_created_gmkt` | event/affiliate-order-consumer | `AFFILIATE_ORDER`, `AFFILIATE_INFLOW` |
| F05 | 결제 완료 처리 | Kafka `bz_carbon_payment_approved_gmkt` | event/affiliate-payment-consumer | `AFFILIATE_ORDER` 업데이트 |
| F06 | 환불/취소 처리 | Kafka 환불 이벤트 | event/affiliate-refund-consumer | `AFFILIATE_ORDER` |
| F07 | 포스트백 발송 | attribution 완료 트리거 | backend/affiliate-postback-api | MSSQL postback queue |

### 2.2 어드민 운영 (2개)

| # | 플로우 | 진입점 | 주요 레포 | 핵심 DB |
|---|---|---|---|---|
| F08 | 파트너 승인/거절 | admin-web UI | admin/affiliate-admin-api | `LINKREW_MEMB_INFO` status |
| F09 | 주문 재처리 배치 | `AffiliateOrderRetryJobConfig` `@Scheduled` | batch/affiliate-order-batch | `AFFILIATE_ORDER` |

### 2.3 어필리에이트 정산 (4개)

| # | 플로우 | 진입점 | 주요 레포 | 핵심 DB |
|---|---|---|---|---|
| F10 | 일/월 정산 집계 배치 | `AffiliateSettlementAggregateJobConfig` | batch/affiliate-settlement-batch | Oracle SP → `AFFILIATE_SETTLE_DAILY`, `AFFILIATE_SETTLE`, `AFFILIATE_SETTLE_PROC` |
| F11 | 정산 정합성 검증 | `affiliateSettleDailyNDetailCompareStep` | 동일 | `AFFILIATE_SETTLE_DAILY` vs `AFFILIATE_SETTLE_DETAIL` |
| F12 | 스마일캐시 이벤트 정산 | `AffiliateShareInsertSmileCashEventMonthlyJobConfig` | batch/affiliate-settlement-batch | `AFFILIATE_SETTLE_SHARE` |
| F13 | 데이터/로그 리텐션 | `AffiliateRetentionJobConfig`, `AffiliateLogRetentionAggregateJobConfig` | batch/affiliate-retention-batch, affiliate-log-batch | Oracle → MongoDB migration |

### 2.4 링크루 전용 (6개)

| # | 플로우 | 진입점 | 주요 레포 | 핵심 DB |
|---|---|---|---|---|
| F14 | 링크루 회원 가입 | `affiliate-web` SignUp (링크루 탭) | frontend → backend/api | `LINKREW_MEMB_INFO`, `LINKREW_BUSINESS` |
| F15 | 링크루 정산 집계 배치 | `LinkrewSettlementAggregateJobConfig` `@Scheduled` | batch/linkrew-settlement-batch | `LINKREW_SETTLE_DAILY`, `LINKREW_SETTLE` |
| F16 | 링크루 송금 처리 배치 | `LinkrewSettlementRemitJobConfig` `@Scheduled` | batch/linkrew-settlement-batch | `LINKREW_SETTLE_PROC` |
| F17 | 역발행 세금계산서 확정 | `LinkrewReverseInvoiceConfirmJobConfig` `@Scheduled` | batch/linkrew-settlement-batch | `LINKREW_BUSINESS`, `LINKREW_INVOICE` |
| F18 | 링크루 메시지 발송 배치 | `LinkrewMessageRequestJobConfig` (어드민 또는 `@Scheduled`) | batch/linkrew-messaging-batch | `LINKREW_MESSAGE_REQUEST`, `LINKREW_NOTI_BOX`, MSSQL `auto_linkrew_common` |
| F19 | 링크루 회원 리텐션 배치 | `LinkrewRetentionMemberAggregateJobConfig` | batch/linkrew-member-batch | `LINKREW_MEMB_INFO` → MongoDB |

---

## 3. 산출물 템플릿 명세

각 플로우 문서의 **필수 섹션**과 **금지 섹션** 정의.

### 3.1 필수 섹션 (Required)

```
## 1. 개요 (Overview)
  - 목적: 한 문장
  - 관련 모듈: 레포명/서브모듈명
  - 주요 히스토리: 티켓/날짜 기준

## 2. 워크플로우 (Workflow Diagram)
  - mermaid sequenceDiagram
  - participant: 실제 DB 테이블 / 서비스 클래스 / 외부 시스템
  - 각 화살표에 실제 메서드명 또는 SQL 표시

## 3. DB 레벨 데이터 흐름 ★ 필수, DB 추적 없으면 미완성
  ### 3.1 관련 테이블 전체 맵
    | 테이블명 | DB (Oracle/MSSQL/Redis/Mongo) | 역할 |
  ### 3.2 단계별 SQL 흐름
    - [STEP N] 설명
    - 실제 SELECT/INSERT/UPDATE/EXEC 쿼리
    - 주요 조건값 (상수, enum 값 포함)
  ### 3.3 전체 처리 순서 요약
    - [DB타입] TABLE ← INSERT/UPDATE/SELECT 순서
  ### 3.4 테이블 참조 관계 (ERD)

## 4. 핵심 컴포넌트
  - 진입점 (Trigger/Reader/Listener)
  - 주요 서비스 (클래스명.메서드명())
  - 저장소 (DB/MQ)

## 5. 구현 체인 완성도 표
  | # | 컴포넌트 | 파일경로:라인 | 상태 |
  - 상태: ✅ 완료 / 🔧 수정필요 / ❌ 미구현

## 6. 예외 처리
  - 실패 시 DB 상태 변화
  - 재시도 여부

## 7. 도메인 지식 Q&A
  - 비자명한 비즈니스 규칙 설명
  - 실제 코드 스니펫 포함
```

### 3.2 금지 섹션 (Forbidden)

- 로컬 개발 환경 이슈 및 해결 (예: 레퍼런스의 섹션 11)
- 서비스 기동 순서
- Docker/k8s 설정
- 배포 파이프라인

> **이유:** 운영 이슈는 빠르게 stale 됨. 비즈니스 로직 이해에 노이즈.

---

## 4. 분석 아키텍처 (3계층)

```
┌─────────────────────────────────────────────────┐
│           컨텍스트 수집 계층                      │
│                                                   │
│  codegraph → call chain, 클래스/메서드/파일경로   │
│  devdb MCP → 테이블 스키마, 컬럼 목록             │
│  oracle MCP → Stored Procedure 정의              │
│  github MCP → Entity/Repository 코드             │
└──────────────────┬──────────────────────────────┘
                   │ structured context
┌──────────────────▼──────────────────────────────┐
│           프롬프트 엔진 계층                       │
│                                                   │
│  Flow Context 조립 (per-flow)                    │
│  섹션별 프롬프트 템플릿 적용                       │
│  DB trace 강제 (SQL 없으면 재생성 요구)            │
│  forbidden 섹션 필터                             │
└──────────────────┬──────────────────────────────┘
                   │ markdown
┌──────────────────▼──────────────────────────────┐
│           출력 계층                               │
│                                                   │
│  per-flow .md 파일                               │
│  wiki-out/{project}/en/system_analysis/flows/    │
│   ├── f01-partner-onboarding.md                  │
│   ├── f02-short-url-issue.md                    │
│   └── ...                                        │
└─────────────────────────────────────────────────┘

3개 구현 레이어 (공통 아키텍처 공유):
  Layer C — 프롬프트 문서    : Claude Code 세션에서 직접 실행
  Layer B — 독립 스크립트   : local-wiki/agent Go runner 확장
  Layer A — wiki-generator  : Next.js 생성 파이프라인 통합
```

---

## 5. Layer C: 프롬프트 엔지니어링 스펙

**용도:** Claude Code 세션에서 특정 플로우를 수동으로 분석할 때 사용.

### 5.1 실행 전 컨텍스트 수집 (순서 고정)

```
STEP 1. codegraph로 진입점 → call chain 추출
  codegraph query "[EntryClass] [key service classes]"
  예) codegraph query "LinkrewMessageRequestJobConfig LinkrewMessageService"

STEP 2. devdb MCP로 관련 테이블 스키마 수집
  mcp__devdb__tableSchema("[TABLE_NAME]")
  예) mcp__devdb__tableSchema("LINKREW_MESSAGE_REQUEST")
      mcp__devdb__tableSchema("LINKREW_NOTI_BOX")

STEP 3. oracle MCP로 SP 정의 수집 (SP 호출이 있는 경우)
  mcp__oracle__schema_definitions("[SP_NAME]")
  예) mcp__oracle__schema_definitions("UPGMKT_Affiliate_AutoLinkrewCommon_Insert")

STEP 4. github MCP로 Repository/Entity 코드 수집
  mcp__github__get_file_contents("[repo]", "[path/to/Entity.java]")
  예) JPA @Query 어노테이션, findBy* 메서드명 → 실제 SQL 추론 근거

STEP 5. 수집된 컨텍스트를 아래 프롬프트에 삽입하여 실행
```

### 5.2 플로우 분석 프롬프트 템플릿

```
당신은 Spring Boot / Spring Batch 기반 마이크로서비스의 비즈니스 플로우 분석 전문가입니다.

## 분석 대상
- 플로우명: [FLOW_NAME]
- 대상 레포: [REPO_NAMES]
- 진입점: [ENTRY_CLASS.METHOD or KAFKA_TOPIC or API_ENDPOINT]

## 수집된 컨텍스트
### Call Chain (codegraph)
[codegraph query 결과 붙여넣기]

### 테이블 스키마 (devdb MCP)
[각 테이블 스키마 붙여넣기]

### SP 정의 (oracle MCP, 있는 경우)
[SP 정의 붙여넣기]

### Repository/Entity 코드 (github MCP)
[주요 Repository 코드 붙여넣기]

## 출력 요구사항

아래 섹션을 **모두** 포함하는 마크다운 문서를 작성하라.

### 필수 포함
1. **개요** — 목적(1문장), 관련 모듈, 주요 히스토리
2. **워크플로우** — `mermaid sequenceDiagram`, participant에 실제 DB 테이블명 포함, 각 화살표에 메서드명/SQL 명시
3. **DB 레벨 데이터 흐름**
   - 관련 테이블 전체 맵: `| 테이블명 | DB종류 | 역할 |`
   - 단계별 SQL 흐름: STEP 1~N 각각에 실제 SQL 쿼리 (SELECT 컬럼, WHERE 조건, INSERT 컬럼 전부)
   - 전체 처리 순서 요약: `[DB] TABLE ← INSERT/UPDATE` 순서
   - 테이블 참조 관계 ERD (텍스트 다이어그램)
4. **핵심 컴포넌트** — 진입점, 주요 서비스 클래스.메서드(), 저장소
5. **구현 체인 완성도 표** — `| # | 컴포넌트 | 파일경로:라인 | 상태(✅/🔧/❌) |`
6. **예외 처리** — 실패 시 DB 상태, 재시도 여부
7. **도메인 지식 Q&A** — 비직관적 비즈니스 규칙, 실제 코드 스니펫 포함

### 절대 포함 금지
- 로컬 개발 환경 이슈 및 해결
- 서비스 기동 순서, Docker 설정
- 배포/CI 관련 내용

### SQL 작성 기준
- 실제 컬럼명 사용 (스키마에서 확인된 것만)
- 주요 조건값: enum 상수, 'N'/'Y' 플래그, 숫자 코드 등 실제 값 표시
- JPA Repository 메서드가 있으면 주석으로 메서드명 표시
  예: `-- JPA: findByMessageRequestSequence(seq)`

SQL을 특정할 수 없는 경우, 반드시 `-- ※ 확인 필요: [이유]` 표기. 추측 SQL 무기입.
```

### 5.3 품질 체크 (생성 후 검증)

```
□ DB 레벨 섹션에 실제 SQL이 STEP별로 있는가?
□ 각 SQL에 실제 테이블명·컬럼명이 있는가? (generic placeholder 없음)
□ 구현 체인 표에 파일경로:라인이 있는가?
□ 금지 섹션이 포함되지 않았는가?
□ mermaid에 DB participant가 있는가?
```

---

## 6. Layer B: 독립 분석 스크립트 설계

**위치:** `~/lab/local-wiki/agent/cmd/business-flow-analyze/`

### 6.1 실행 방식

```bash
# 특정 플로우 분석
local-wiki-agent analyze-flow --flow F18 --project ~/work/martech/affiliate --out ./flows/

# 전체 카탈로그 순차 분석
local-wiki-agent analyze-flow --all --project ~/work/martech/affiliate --out ./flows/
```

### 6.2 처리 파이프라인 (Go)

```go
// internal/runner/flow_analyzer.go

type FlowAnalyzer struct {
    codegraph  CodegraphClient  // local codegraph CLI wrapper
    devdb      MCPClient        // devdb MCP
    oracle     MCPClient        // oracle MCP
    github     MCPClient        // github MCP
    llm        Runner           // claude/gemini/antigravity
}

func (a *FlowAnalyzer) Analyze(flow FlowDefinition) (string, error) {
    // 1. Call chain
    chain, _ := a.codegraph.Query(flow.EntryClasses...)
    
    // 2. Table schemas
    schemas := map[string]string{}
    for _, table := range flow.Tables {
        s, _ := a.devdb.TableSchema(table)
        schemas[table] = s
    }
    
    // 3. SP definitions (optional)
    sps := map[string]string{}
    for _, sp := range flow.StoredProcs {
        d, _ := a.oracle.SchemaDefinitions(sp)
        sps[sp] = d
    }
    
    // 4. Entity/Repository code
    code := map[string]string{}
    for _, ref := range flow.CodeRefs {
        c, _ := a.github.GetFileContents(ref.Repo, ref.Path)
        code[ref.Path] = c
    }
    
    // 5. Assemble context & run prompt
    ctx := assembleContext(chain, schemas, sps, code)
    return a.llm.Run(buildPrompt(flow, ctx))
}
```

### 6.3 플로우 카탈로그 정의 파일

테이블에 `db` 필드, 코드 레퍼런스에 `host` 필드를 추가하여 인스턴스 자동 선택 기반으로 작성한다.

```yaml
# flows/catalog.yaml
flows:
  - id: F18
    name: 링크루 메시지 발송 배치
    repos: [affiliate-batch]
    entryClasses:
      - LinkrewMessageRequestJobConfig
      - LinkrewMessageService
      - SendMessageTargetSupportServiceBaseImpl
    tables:
      - name: LINKREW_MESSAGE_REQUEST
        db: O_GAFFILIATE          # → oracle-gaffiliate 인스턴스 선택
      - name: LINKREW_MESSAGE_DETAIL
        db: O_GAFFILIATE
      - name: LINKREW_MEMB_INFO
        db: O_GAFFILIATE
      - name: LINKREW_NOTI_BOX
        db: O_GAFFILIATE
      - name: auto_linkrew_common
        db: nautomaildb            # → devdb-nautomaildb 인스턴스 선택
    storedProcs:
      - name: UPGMKT_Affiliate_AutoLinkrewCommon_Insert
        db: nautomaildb
    codeRefs:
      - host: github.gmarket.com   # → github-enterprise 인스턴스 선택
        repo: affiliate-batch
        path: lib-message/src/main/java/com/gmarket/affiliate/batch/message/service/LinkrewMessageService.java
      - host: github.gmarket.com
        repo: affiliate-batch
        path: lib-core/src/main/java/com/gmarket/affiliate/batch/core/type/LinkrewMessageTemplateType.java
```

### 6.4 MCP 연결 현황 및 문제점

현재 `local-wiki/agent`의 MCP 클라이언트 (`runner/claude.go` 등)는 AI runner 추상화만 구현함. MCP 도구 직접 호출이 없음.

**추가 필요:**
- `internal/mcp/` 패키지 신설
- devdb, oracle, github MCP를 JSON-RPC over stdio로 직접 호출
- 또는 Claude Code 세션 내에서 MCP 도구 사용하는 방식으로 Layer C 활용

---

## 7. Layer A: wiki-generator.ts 통합 설계

### 7.1 현재 문제 위치

`src/lib/wiki-generator.ts`의 `multi-project` 섹션 힌트:
```
2. Business Flows — ONE PAGE PER major end-to-end business flow
```
→ 실제로는 단일 `business_flow.md` 생성. 이유: per-page 생성 루프가 없음.

### 7.2 수정 방향

**Phase 1: 플로우별 개별 파일 생성**

`generatePages()` 함수에서 `business_flows` 타입 섹션을 감지하면:
```typescript
// wiki-generator.ts 수정 포인트

if (section.type === 'business_flows') {
  // 카탈로그에서 플로우 목록 추출
  const flows = await extractFlowsFromCatalog(projectPath);
  
  for (const flow of flows) {
    // per-flow context 수집
    const context = await collectFlowContext(flow);
    
    // per-flow 문서 생성
    const content = await generateFlowPage(flow, context);
    
    // flows/ 서브디렉토리에 저장
    await savePage(`system_analysis/flows/${flow.slug}.md`, content);
  }
}
```

**Phase 2: MCP 컨텍스트 수집 함수 (인스턴스 기반)**

```typescript
async function collectFlowContext(
  flow: FlowDefinition,
  instances: McpInstance[],   // local-wiki 설정에서 주입
): Promise<FlowContext> {
  const [chain, schemas, spDefs, code] = await Promise.all([
    queryCodegraph(flow.entryClasses),
    Promise.all(flow.tables.map(t => {
      // db 필드로 인스턴스 선택 → role: db-schema
      const inst = resolveInstance(instances, 'db-schema', { database: t.db });
      return inst ? callMcp(inst, 'tableSchema', t.name) : fallbackFromCode(t.name);
    })),
    Promise.all((flow.storedProcs ?? []).map(sp => {
      const inst = resolveInstance(instances, 'db-stored-proc', { database: sp.db });
      return inst ? callMcp(inst, 'storedProc', sp.name) : fallbackFromAnnotation(sp.name);
    })),
    Promise.all(flow.codeRefs.map(ref => {
      const inst = resolveInstance(instances, 'code-reader', { host: ref.host });
      return inst ? callMcp(inst, 'getFile', ref.repo, ref.path) : fallbackFromCodegraph(ref.path);
    })),
  ]);
  return { chain, schemas, spDefs, code };
}

// scope 매칭으로 인스턴스 선택
function resolveInstance(
  instances: McpInstance[],
  role: string,
  scope: { database?: string; host?: string },
): McpInstance | null {
  return instances.find(inst =>
    inst.roles.includes(role) &&
    (scope.database ? inst.scope.databases?.includes(scope.database) : true) &&
    (scope.host ? inst.scope.host === scope.host : true),
  ) ?? null;
}
```

**Phase 3: 섹션 힌트 강화**

`multi-project` 타입 힌트에 아래를 추가:
```
BUSINESS FLOWS GENERATION RULES:
- Each flow MUST have its own file under flows/
- DB-level SQL section is REQUIRED — reject output without actual SQL
- Forbidden: local dev issues, deployment config, startup order
- Required: mermaid sequenceDiagram with DB participants, component chain table
```

### 7.3 MCP 연결 현황 및 설계 방향

현재 `wiki-generator.ts`는 `fetchContent(prompt)` → LLM 단순 호출만 함. MCP 도구 호출 경로 없음.

**단기 해결책 (Layer C 활용):**
LLM 프롬프트에 역할 + scope 기반 지시 포함 (도구명 하드코딩 금지):
```
"O_GAFFILIATE DB의 LINKREW_MESSAGE_REQUEST 스키마를 조회하라.
 세션에 활성화된 Oracle DB MCP 도구를 사용한다."
```

**장기 해결책 (Layer A 통합):**
`taskStreamClient.ts`에 `McpInstanceRegistry`를 주입. local-wiki 설정의 `mcpInstances` 배열을 읽어
`collectFlowContext()` 호출 시 인스턴스를 자동 선택하여 `fetchContent()` 전 컨텍스트 조립.

---

## 8. MCP 인스턴스 설계

MCP 도구명을 하드코딩하지 않는다. **역할(role) → 인스턴스(instance) → 도구(tool)** 3단 구조로
어떤 사용자 환경에서도 동작하도록 설계한다.

### 8.1 개념 구조

```
역할 (role)          인스턴스 (instance)         도구 (tool prefix)
─────────────────────────────────────────────────────────────────────
db-schema       →   oracle-gaffiliate     →   mcp__oracle__*
db-schema       →   devdb-nautomaildb     →   mcp__devdb__*
db-stored-proc  →   oracle-gaffiliate     →   mcp__oracle__*
code-reader     →   github-enterprise     →   mcp__github__*   (host: github.internal.co)
code-reader     →   github-public         →   mcp__github__*   (host: api.github.com)
```

- **같은 역할, 다른 인스턴스:** Oracle O_GAFFILIATE와 MSSQL nautomaildb는 둘 다 `db-schema` 역할이지만 서로 다른 MCP 인스턴스
- **같은 도구, 다른 서버:** `github` MCP 도구는 동일하나 enterprise 서버와 public 서버는 별도 인스턴스로 관리

### 8.2 local-wiki 설정 스키마

설정 패널(또는 `local-wiki settings.json`)에 아래 구조를 추가한다.

```json
{
  "businessFlowAnalysis": {
    "mcpInstances": [
      {
        "instanceName": "oracle-gaffiliate",
        "tool": "oracle",
        "roles": ["db-schema", "db-stored-proc", "db-query"],
        "scope": {
          "databases": ["O_GAFFILIATE"],
          "description": "Oracle 어필리에이트 스키마"
        }
      },
      {
        "instanceName": "devdb-nautomaildb",
        "tool": "devdb",
        "roles": ["db-schema"],
        "scope": {
          "databases": ["nautomaildb", "neption"],
          "description": "MSSQL 이메일 발송 DB"
        }
      },
      {
        "instanceName": "redis-affiliate",
        "tool": "redis-mcp",
        "roles": ["db-schema", "db-query"],
        "scope": {
          "databases": ["redis"],
          "description": "Redis NotiBox / 캐시"
        }
      },
      {
        "instanceName": "github-enterprise",
        "tool": "github",
        "roles": ["code-reader"],
        "scope": {
          "host": "github.gmarket.com",
          "orgs": ["gmarket-affiliate"],
          "description": "사내 GitHub Enterprise"
        }
      }
    ]
  }
}
```

**외부(public) 사용자 예시:**
```json
{
  "mcpInstances": [
    {
      "instanceName": "postgres-main",
      "tool": "postgres",
      "roles": ["db-schema", "db-query"],
      "scope": { "databases": ["myapp_db"] }
    },
    {
      "instanceName": "github-public",
      "tool": "github",
      "roles": ["code-reader"],
      "scope": { "host": "api.github.com" }
    }
  ]
}
```

### 8.3 인스턴스 선택 로직

플로우 카탈로그에서 테이블/레포의 `db`·`host` 속성을 읽어 `scope` 매칭으로 인스턴스를 자동 선택한다.

```
플로우 카탈로그                    설정 scope 매칭         선택 인스턴스
────────────────────────────────────────────────────────────────────────
table.db = "O_GAFFILIATE"    →   databases: ["O_GAFFILIATE"]   →  oracle-gaffiliate
table.db = "nautomaildb"     →   databases: ["nautomaildb"]    →  devdb-nautomaildb
codeRef.host = "github.gmarket.com" → host: "github.gmarket.com" → github-enterprise
```

**매칭 실패(인스턴스 미설정) 시:** 코드 폴백 전략 적용 (8.5 참조)

### 8.4 역할별 표준 도구 액션

각 역할에서 어떤 MCP 액션을 호출할지는 **도구명**이 아닌 **역할 표준 액션**으로 정의한다.
런타임에 선택된 인스턴스의 `tool` 값으로 실제 `mcp__<tool>__<action>` 이름을 조합한다.

| 역할 | 표준 액션 | 실제 호출 예 (tool=oracle) | 실제 호출 예 (tool=devdb) |
|---|---|---|---|
| `db-schema` | `tableSchema(name)` | `mcp__oracle__schema_definitions` | `mcp__devdb__tableSchema` |
| `db-schema` | `fkRelations(name)` | `mcp__oracle__execute_query` (FK 쿼리) | `mcp__devdb__dependsTable` |
| `db-stored-proc` | `storedProc(name)` | `mcp__oracle__schema_definitions` | — (미지원) |
| `db-query` | `execute(sql)` | `mcp__oracle__execute_query` | `mcp__devdb__resolveDataSource` |
| `code-reader` | `getFile(repo, path)` | — | `mcp__github__get_file_contents` |
| `code-reader` | `searchCode(query, repo)` | — | `mcp__github__search_code` |

> 각 MCP 도구의 실제 액션 이름 매핑은 `mcpInstances[].actionMap` 필드로 오버라이드 가능.
> 기본값은 표준 액션명 → 도구별 알려진 액션으로 자동 매핑.

### 8.5 폴백 전략 (인스턴스 미설정 또는 호출 실패)

```
db-schema 실패
  → codegraph query "[TableName] entity"
  → JPA @Table, @Column 어노테이션에서 스키마 추론

db-stored-proc 실패
  → codegraph query "[SP_NAME]"
  → @SaturnProcedure 어노테이션 파라미터에서 추론

code-reader 실패
  → codegraph_explore "[ClassName]"
  → 소스 직접 조회

전부 실패
  → 해당 SQL에 "-- ※ MCP 미연결: 수동 확인 필요 ([인스턴스명])" 표기
  → 문서 생성은 계속 진행 (블로킹하지 않음)
```

### 8.6 프롬프트에서의 인스턴스 참조 방식 (Layer C)

Layer C (수동 프롬프트) 사용 시, 세션에 로드된 MCP 중 역할에 맞는 인스턴스를 명시한다.
**도구명을 직접 쓰지 않고 역할과 scope로 지시한다.**

```
# 잘못된 방식 (하드코딩)
mcp__devdb__tableSchema("LINKREW_MESSAGE_REQUEST")

# 올바른 방식 (역할 + scope 기술)
"O_GAFFILIATE DB의 LINKREW_MESSAGE_REQUEST 테이블 스키마를 조회하라.
 현재 세션에서 Oracle DB에 접근 가능한 MCP 도구를 사용한다."
```

LLM은 세션에 로드된 도구 목록에서 scope에 맞는 인스턴스를 자동 선택한다.

---

## 9. 구현 우선순위

| 단계 | 내용 | 즉시 가치 |
|---|---|---|
| **1단계** | Layer C 프롬프트 스펙 완성 → Claude Code 세션에서 수동 실행 | 즉시 사용 가능 |
| **2단계** | `flows/catalog.yaml` 작성 (19개 플로우 정의) | Layer B/A 기반 |
| **3단계** | Layer B 스크립트 (`analyze-flow` 커맨드) | 반자동화 |
| **4단계** | Layer A wiki-generator.ts 통합 | 완전 자동화 |

---

## 10. 산출물 저장 위치

```
~/Documents/Documents/work/workflows/affiliate-batch/
  Linkrew_Messaging_Business_Flow.md          ← 레퍼런스 (기존)
  flows/
    f01-partner-onboarding.md
    f02-short-url-issue.md
    f03-inflow-click.md
    ...
    f18-linkrew-messaging-batch.md            ← 레퍼런스와 동일 수준
    f19-linkrew-member-retention.md

~/lab/local-wiki/
  docs/superpowers/specs/
    2026-06-24-affiliate-business-flow-analysis-design.md  ← 이 문서
  flows/catalog.yaml                                        ← 플로우 카탈로그 (2단계)
```
