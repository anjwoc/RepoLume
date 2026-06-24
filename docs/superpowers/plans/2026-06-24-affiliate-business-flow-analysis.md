# Affiliate 비즈니스 플로우 분석 시스템 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6개 affiliate 레포에서 19개 비즈니스 플로우를 자동으로 DB 레벨 SQL 추적까지 포함한 per-flow 문서로 생성하는 시스템을 구축한다.

**Architecture:** 역할(role) → 인스턴스(instance) → 도구(tool) 3단 MCP 추상화로 사내/외부 환경을 모두 지원한다. catalog.yaml에 플로우 정의(DB scope, host scope 포함)를 두고, wiki-generator.ts가 이를 읽어 per-flow 프롬프트를 LLM에 전달한다. LLM이 세션 MCP를 직접 호출하여 스키마/코드를 수집한다.

**Tech Stack:** TypeScript (Next.js), Go 1.21+, js-yaml, Vitest, ajv

**Design Spec:** `docs/superpowers/specs/2026-06-24-affiliate-business-flow-analysis-design.md`

## Global Constraints

- working dir: `~/lab/local-wiki`
- 프롬프트에 MCP 도구명 하드코딩 금지 — 역할+scope 기술 방식 사용
- SQL 추측 금지 — 확인 불가 시 `-- ※ MCP 미연결: 수동 확인 필요 (instanceName)` 표기
- 금지 섹션: local dev issues, 서비스 기동순서, Docker/k8s, 배포 파이프라인
- DB 레벨 SQL 섹션 없으면 생성 실패로 간주
- Go module path: `github.com/localwiki/agent`
- TypeScript: 기존 `src/lib/` 파일 패턴 유지 (named export, no default export)

---

### Task 1: Layer C — 비즈니스 플로우 프롬프트 스펙 문서

플로우 1개를 Claude Code 세션에서 수동으로 분석할 때 바로 쓸 수 있는 프롬프트 가이드.

**Files:**
- Create: `docs/business-flow-prompts/PROMPT_SPEC.md`

- [ ] **Step 1: docs/business-flow-prompts/ 디렉토리 생성**

```bash
mkdir -p ~/lab/local-wiki/docs/business-flow-prompts
```

- [ ] **Step 2: PROMPT_SPEC.md 작성**

`docs/business-flow-prompts/PROMPT_SPEC.md` 전체 내용:

```markdown
# 비즈니스 플로우 분석 프롬프트 스펙

## 사용법

아래 순서대로 Claude Code 세션에서 실행한다.
각 STEP은 독립 메시지로 전송하거나 하나의 메시지에 묶어 전송 가능.

---

## STEP 1: Call Chain 수집 (codegraph)

```
codegraph query "[진입점 클래스명] [주요 서비스 클래스명]"

예시:
codegraph query "LinkrewMessageRequestJobConfig LinkrewMessageService SendMessageTargetSupportServiceBaseImpl"
```

---

## STEP 2: DB 스키마 수집 (역할 기반)

각 테이블에 대해, 해당 DB에 접근 가능한 MCP 도구를 사용한다.
도구명을 고정하지 않고 역할+scope로 지시한다.

```
[Oracle O_GAFFILIATE 테이블]
"O_GAFFILIATE DB의 [테이블명] 스키마를 조회하라.
 현재 세션에서 Oracle DB에 접근 가능한 MCP 도구를 사용한다."

[MSSQL nautomaildb 테이블]
"nautomaildb의 [테이블명] 스키마를 조회하라.
 현재 세션에서 MSSQL에 접근 가능한 MCP 도구를 사용한다."

[MCP 없을 때 폴백]
codegraph query "[TableName] entity" → JPA @Table, @Column 어노테이션 확인
```

---

## STEP 3: Stored Procedure 정의 수집 (있는 경우)

```
"[SP명]의 정의를 조회하라.
 Oracle DB MCP를 사용하거나, 없으면 @SaturnProcedure 어노테이션에서 추론하라."
```

---

## STEP 4: Repository/Entity 코드 수집

```
"[host]의 [repo] 레포에서 [파일경로]를 조회하라.
 현재 세션에서 GitHub에 접근 가능한 MCP 도구를 사용한다."

예시:
"github.gmarket.com의 affiliate-batch 레포에서
 lib-message/.../LinkrewMessageService.java를 조회하라."
```

---

## STEP 5: 분석 실행 — 아래 프롬프트 전송

```
위에서 수집한 컨텍스트를 바탕으로 아래 요구사항에 맞는 비즈니스 플로우 문서를 작성하라.

## 필수 섹션 (7개, 모두 포함)

1. **개요** — 목적(1문장), 관련 모듈(레포/서브모듈), 주요 히스토리(티켓/날짜)

2. **워크플로우** — mermaid sequenceDiagram
   - participant에 실제 DB 테이블명 포함 (예: DB_Request as "Oracle: LINKREW_MESSAGE_REQUEST")
   - 각 화살표에 실제 메서드명 또는 SQL 조건 표시

3. **DB 레벨 데이터 흐름** ★ 이 섹션 없으면 문서 미완성
   - 관련 테이블 전체 맵: `| 테이블명 | DB종류 | 역할 |`
   - 단계별 SQL 흐름: [STEP 1] ~ [STEP N] 각각에 실제 SELECT/INSERT/UPDATE/EXEC 쿼리
     - 실제 컬럼명, WHERE 조건값, enum 상수 ('N'/'Y', 'B'/'C' 등) 포함
     - JPA 메서드명은 주석으로: `-- JPA: findByPartnerType(PartnerType.B2C)`
     - 확인 불가 SQL: `-- ※ MCP 미연결: 수동 확인 필요 (oracle-gaffiliate)`
   - 전체 처리 순서 요약: `[Oracle] LINKREW_MESSAGE_REQUEST ← INSERT (PROC_YN='N')` 형식
   - 테이블 참조 관계 (텍스트 ERD)

4. **핵심 컴포넌트** — 진입점, 주요 서비스 클래스.메서드(), 저장소
   파일경로:라인번호 포함

5. **구현 체인 완성도 표**
   `| # | 컴포넌트 | 파일경로:라인 | 상태(✅/🔧/❌) |`

6. **예외 처리** — 실패 시 DB 상태 변화, 재시도 여부

7. **도메인 지식 Q&A** — 비직관적 규칙, 실제 코드 스니펫 포함

## 절대 포함 금지
- 로컬 개발 환경 이슈 및 해결
- 서비스 기동 순서
- Docker/k8s 설정
- 배포/CI 관련 내용
```

---

## 플로우별 빠른 참조

| 플로우 ID | 진입 클래스 | 핵심 테이블 | DB |
|---|---|---|---|
| F01 | SignUpService | LINKREW_MEMB_INFO | O_GAFFILIATE |
| F02 | ShortUrlController | AFFILIATE_SHORT_URL | O_GAFFILIATE |
| F03 | InflowShortUrlService | (MongoDB inflow log) | MongoDB |
| F04 | OrderPlacedListener | AFFILIATE_ORDER, AFFILIATE_INFLOW | O_GAFFILIATE |
| F05 | (payment consumer) | AFFILIATE_ORDER | O_GAFFILIATE |
| F06 | (refund consumer) | AFFILIATE_ORDER | O_GAFFILIATE |
| F07 | PostbackService | (MSSQL postback queue) | MSSQL |
| F08 | LinkrewMembInfoRestController | LINKREW_MEMB_INFO | O_GAFFILIATE |
| F09 | AffiliateOrderRetryJobConfig | AFFILIATE_ORDER | O_GAFFILIATE |
| F10 | AffiliateSettlementAggregateJobConfig | AFFILIATE_SETTLE_DAILY, AFFILIATE_SETTLE | O_GAFFILIATE |
| F11 | affiliateSettleDailyNDetailCompareStep | AFFILIATE_SETTLE_DAILY, AFFILIATE_SETTLE_DETAIL | O_GAFFILIATE |
| F12 | AffiliateShareInsertSmileCashEventMonthlyJobConfig | AFFILIATE_SETTLE_SHARE | O_GAFFILIATE |
| F13 | AffiliateRetentionJobConfig | (Oracle → MongoDB) | O_GAFFILIATE / MongoDB |
| F14 | SignUpService (링크루) | LINKREW_MEMB_INFO, LINKREW_BUSINESS | O_GAFFILIATE |
| F15 | LinkrewSettlementAggregateJobConfig | LINKREW_SETTLE_DAILY, LINKREW_SETTLE | O_GAFFILIATE |
| F16 | LinkrewSettlementRemitJobConfig | LINKREW_SETTLE_PROC | O_GAFFILIATE |
| F17 | LinkrewReverseInvoiceConfirmJobConfig | LINKREW_BUSINESS, LINKREW_INVOICE | O_GAFFILIATE |
| F18 | LinkrewMessageRequestJobConfig | LINKREW_MESSAGE_REQUEST, LINKREW_NOTI_BOX, auto_linkrew_common | O_GAFFILIATE / nautomaildb |
| F19 | LinkrewRetentionMemberAggregateJobConfig | LINKREW_MEMB_INFO → MongoDB | O_GAFFILIATE / MongoDB |
```

- [ ] **Step 3: 검증 — F18(링크루 메시지 발송)으로 수동 실행 테스트**

Claude Code 세션에서 F18을 직접 실행하여 레퍼런스(`Linkrew_Messaging_Business_Flow.md`)와 품질 비교:
- DB 레벨 SQL STEP이 있는가?
- 실제 컬럼명이 있는가?
- 구현 체인 표가 있는가?
- 금지 섹션이 없는가?

- [ ] **Step 4: Commit**

```bash
cd ~/lab/local-wiki
git add docs/business-flow-prompts/PROMPT_SPEC.md
git commit -m "docs: Layer C business flow prompt spec with role-based MCP instructions"
```

---

### Task 2: flows/catalog.yaml + 스키마 검증

**Files:**
- Create: `flows/catalog.schema.json`
- Create: `flows/catalog.yaml`

**Interfaces:**
- Produces: `FlowDefinition[]` — Task 4의 `loadCatalog()` 가 이 파일을 읽음

- [ ] **Step 1: catalog.schema.json 작성**

`flows/catalog.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["flows"],
  "properties": {
    "flows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "repos", "entryClasses", "tables", "codeRefs"],
        "properties": {
          "id":           { "type": "string", "pattern": "^F[0-9]{2}$" },
          "name":         { "type": "string" },
          "repos":        { "type": "array", "items": { "type": "string" } },
          "entryClasses": { "type": "array", "items": { "type": "string" } },
          "tables": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "db"],
              "properties": {
                "name": { "type": "string" },
                "db":   { "type": "string" }
              }
            }
          },
          "storedProcs": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["name", "db"],
              "properties": {
                "name": { "type": "string" },
                "db":   { "type": "string" }
              }
            }
          },
          "codeRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["host", "repo", "path"],
              "properties": {
                "host": { "type": "string" },
                "repo": { "type": "string" },
                "path": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: catalog.yaml 작성 (19개 플로우)**

`flows/catalog.yaml`:

```yaml
flows:
  - id: F01
    name: 파트너 가입 & 온보딩
    repos: [affiliate-frontend, affiliate-backend, affiliate-admin]
    entryClasses: [SignUpService, LinkrewMembInfoJpaEntity]
    tables:
      - { name: LINKREW_MEMB_INFO, db: O_GAFFILIATE }
      - { name: LINKREW_BUSINESS,  db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-frontend, path: affiliate-web/src/main/java/com/gmarket/affiliate/web/service/SignUpService.java }
      - { host: github.gmarket.com, repo: affiliate-backend,  path: affiliate-api/src/main/java/com/gmarket/affiliate/api/entity/LinkrewMembInfoJpaEntity.java }

  - id: F02
    name: 쇼트링크 발급
    repos: [affiliate-gateway, affiliate-backend]
    entryClasses: [ShortUrlController, IssueShortUrlService]
    tables:
      - { name: AFFILIATE_SHORT_URL, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-backend, path: affiliate-api/src/main/java/com/gmarket/affiliate/api/controller/ShortUrlController.java }
      - { host: github.gmarket.com, repo: affiliate-backend, path: affiliate-api/src/main/java/com/gmarket/affiliate/api/service/IssueShortUrlService.java }

  - id: F03
    name: 유입(클릭) 처리
    repos: [affiliate-gateway, affiliate-backend]
    entryClasses: [InflowShortUrlService]
    tables:
      - { name: affiliate_inflow_log, db: MongoDB }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-backend, path: affiliate-api/src/main/java/com/gmarket/affiliate/api/service/InflowShortUrlService.java }

  - id: F04
    name: 주문 어트리뷰션
    repos: [affiliate-event]
    entryClasses: [OrderPlacedListener]
    tables:
      - { name: AFFILIATE_ORDER,  db: O_GAFFILIATE }
      - { name: AFFILIATE_INFLOW, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-event, path: affiliate-order-consumer/src/main/java/com/gmarket/affiliate/consumer/order/listener/OrderPlacedListener.java }

  - id: F05
    name: 결제 완료 처리
    repos: [affiliate-event]
    entryClasses: [PaymentApprovedListener]
    tables:
      - { name: AFFILIATE_ORDER, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-event, path: affiliate-payment-consumer/src/main/java/com/gmarket/affiliate/consumer/payment/listener/PaymentApprovedListener.java }

  - id: F06
    name: 환불/취소 처리
    repos: [affiliate-event]
    entryClasses: [RefundListener]
    tables:
      - { name: AFFILIATE_ORDER, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-event, path: affiliate-refund-consumer/src/main/java/com/gmarket/affiliate/consumer/refund/listener/RefundListener.java }

  - id: F07
    name: 포스트백 발송
    repos: [affiliate-backend]
    entryClasses: [PostbackService]
    tables:
      - { name: AFFILIATE_POSTBACK_HISTORY, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-backend, path: affiliate-postback-api/src/main/java/com/gmarket/affiliate/postback/service/PostbackService.java }

  - id: F08
    name: 어드민 파트너 승인/거절
    repos: [affiliate-admin]
    entryClasses: [LinkrewMembInfoRestController, LinkrewStatusUpdateService]
    tables:
      - { name: LINKREW_MEMB_INFO, db: O_GAFFILIATE }
      - { name: LINKREW_STATUS,    db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-admin, path: affiliate-admin-api/src/main/java/com/gmarket/admin/affiliate/api/controller/LinkrewBusinessRestController.java }

  - id: F09
    name: 주문 재처리 배치
    repos: [affiliate-batch]
    entryClasses: [AffiliateOrderRetryJobConfig]
    tables:
      - { name: AFFILIATE_ORDER, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: affiliate-order-batch/src/main/java/com/gmarket/affiliate/batch/config/job/AffiliateOrderRetryJobConfig.java }

  - id: F10
    name: 일/월 정산 집계 배치
    repos: [affiliate-batch]
    entryClasses: [AffiliateSettlementAggregateJobConfig, AffiliateSettlementDailyWriter]
    tables:
      - { name: AFFILIATE_SETTLE_DAILY,  db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE_DETAIL, db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE,        db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE_PROC,   db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: affiliate-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/AffiliateSettlementAggregateJobConfig.java }

  - id: F11
    name: 정산 정합성 검증 배치
    repos: [affiliate-batch]
    entryClasses: [AffiliateSettlementAggregateJobConfig]
    tables:
      - { name: AFFILIATE_SETTLE_DAILY,  db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE_DETAIL, db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE,        db: O_GAFFILIATE }
      - { name: AFFILIATE_SETTLE_PROC,   db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: affiliate-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/AffiliateSettlementAggregateJobConfig.java }

  - id: F12
    name: 스마일캐시 이벤트 정산 배치
    repos: [affiliate-batch]
    entryClasses: [AffiliateShareInsertSmileCashEventMonthlyJobConfig]
    tables:
      - { name: AFFILIATE_SETTLE_SHARE, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: affiliate-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/AffiliateShareInsertSmileCashEventMonthlyJobConfig.java }

  - id: F13
    name: 데이터/로그 리텐션 배치
    repos: [affiliate-batch]
    entryClasses: [AffiliateRetentionJobConfig, AffiliateLogRetentionAggregateJobConfig]
    tables:
      - { name: AFFILIATE_INFLOW_LOG, db: O_GAFFILIATE }
      - { name: affiliate_log_archive, db: MongoDB }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: affiliate-retention-batch/src/main/java/com/gmarket/affiliate/batch/config/AffiliateJobConfig.java }

  - id: F14
    name: 링크루 회원 가입
    repos: [affiliate-frontend, affiliate-backend]
    entryClasses: [SignUpService, LinkrewMembInfoJpaEntity]
    tables:
      - { name: LINKREW_MEMB_INFO, db: O_GAFFILIATE }
      - { name: LINKREW_BUSINESS,  db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-backend, path: affiliate-api/src/main/java/com/gmarket/affiliate/api/service/SignUpService.java }

  - id: F15
    name: 링크루 정산 집계 배치
    repos: [affiliate-batch]
    entryClasses: [LinkrewSettlementAggregateJobConfig]
    tables:
      - { name: LINKREW_SETTLE_DAILY, db: O_GAFFILIATE }
      - { name: LINKREW_SETTLE,       db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: linkrew-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/LinkrewSettlementAggregateJobConfig.java }

  - id: F16
    name: 링크루 송금 처리 배치
    repos: [affiliate-batch]
    entryClasses: [LinkrewSettlementRemitJobConfig]
    tables:
      - { name: LINKREW_SETTLE_PROC, db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: linkrew-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/LinkrewSettlementRemitJobConfig.java }

  - id: F17
    name: 역발행 세금계산서 확정 배치
    repos: [affiliate-batch]
    entryClasses: [LinkrewReverseInvoiceConfirmJobConfig]
    tables:
      - { name: LINKREW_BUSINESS, db: O_GAFFILIATE }
      - { name: LINKREW_INVOICE,  db: O_GAFFILIATE }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: linkrew-settlement-batch/src/main/java/com/gmarket/affiliate/batch/config/job/LinkrewReverseInvoiceConfirmJobConfig.java }

  - id: F18
    name: 링크루 메시지 발송 배치
    repos: [affiliate-batch, affiliate-admin]
    entryClasses: [LinkrewMessageRequestJobConfig, LinkrewMessageService, SendMessageTargetSupportServiceBaseImpl]
    tables:
      - { name: LINKREW_MESSAGE_REQUEST, db: O_GAFFILIATE }
      - { name: LINKREW_MESSAGE_DETAIL,  db: O_GAFFILIATE }
      - { name: LINKREW_MEMB_INFO,       db: O_GAFFILIATE }
      - { name: LINKREW_NOTI_BOX,        db: O_GAFFILIATE }
      - { name: auto_linkrew_common,     db: nautomaildb }
    storedProcs:
      - { name: UPGMKT_Affiliate_AutoLinkrewCommon_Insert, db: nautomaildb }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: lib-message/src/main/java/com/gmarket/affiliate/batch/message/service/LinkrewMessageService.java }
      - { host: github.gmarket.com, repo: affiliate-batch, path: lib-core/src/main/java/com/gmarket/affiliate/batch/core/type/LinkrewMessageTemplateType.java }
      - { host: github.gmarket.com, repo: affiliate-batch, path: lib-message/src/main/java/com/gmarket/affiliate/batch/message/service/support/impl/SendMessageTargetSupportServiceBaseImpl.java }

  - id: F19
    name: 링크루 회원 리텐션 배치
    repos: [affiliate-batch]
    entryClasses: [LinkrewRetentionMemberAggregateJobConfig]
    tables:
      - { name: LINKREW_MEMB_INFO,         db: O_GAFFILIATE }
      - { name: linkrew_member_archive,    db: MongoDB }
    codeRefs:
      - { host: github.gmarket.com, repo: affiliate-batch, path: linkrew-member-batch/src/main/java/com/gmarket/affiliate/batch/config/job/LinkrewRetentionMemberAggregateJobConfig.java }
```

- [ ] **Step 3: ajv로 스키마 검증**

```bash
cd ~/lab/local-wiki
npx ajv validate -s flows/catalog.schema.json -d flows/catalog.yaml --spec=draft7 2>&1
```

Expected: `flows/catalog.yaml valid`  
실패 시: 오류 메시지의 필드명을 확인하고 catalog.yaml 수정

- [ ] **Step 4: Commit**

```bash
git add flows/catalog.schema.json flows/catalog.yaml
git commit -m "feat: add business flow catalog (19 flows) with db/host scope"
```

---

### Task 3: Vitest 설정 + mcp-instance-registry.ts

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (test:unit 스크립트 추가)
- Create: `src/lib/mcp-instance-registry.ts`
- Create: `src/lib/__tests__/mcp-instance-registry.test.ts`

**Interfaces:**
- Produces:
  - `McpRole` — `'db-schema' | 'db-stored-proc' | 'db-query' | 'code-reader'`
  - `McpInstance` — `{ instanceName, tool, roles, scope }`
  - `resolveInstance(instances, role, scope)` → `McpInstance | null`
  - `mcpToolPrefix(instance)` → `string` (예: `"mcp__oracle__"`)

- [ ] **Step 1: Vitest 설치**

```bash
cd ~/lab/local-wiki
pnpm add -D vitest @vitejs/plugin-react
```

- [ ] **Step 2: vitest.config.ts 작성**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: package.json에 test:unit 스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
"test:unit": "vitest run"
```

- [ ] **Step 4: 실패하는 테스트 먼저 작성**

`src/lib/__tests__/mcp-instance-registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveInstance, mcpToolPrefix, McpInstance } from '../mcp-instance-registry';

const fixtures: McpInstance[] = [
  {
    instanceName: 'oracle-gaffiliate',
    tool: 'oracle',
    roles: ['db-schema', 'db-stored-proc', 'db-query'],
    scope: { databases: ['O_GAFFILIATE'] },
  },
  {
    instanceName: 'devdb-nautomaildb',
    tool: 'devdb',
    roles: ['db-schema'],
    scope: { databases: ['nautomaildb', 'neption'] },
  },
  {
    instanceName: 'github-enterprise',
    tool: 'github',
    roles: ['code-reader'],
    scope: { host: 'github.gmarket.com' },
  },
];

describe('resolveInstance', () => {
  it('db로 oracle 인스턴스 선택', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'O_GAFFILIATE' })?.instanceName)
      .toBe('oracle-gaffiliate');
  });

  it('db로 devdb 인스턴스 선택', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'nautomaildb' })?.instanceName)
      .toBe('devdb-nautomaildb');
  });

  it('neption도 devdb 인스턴스에 매핑', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'neption' })?.instanceName)
      .toBe('devdb-nautomaildb');
  });

  it('host로 github 인스턴스 선택', () => {
    expect(resolveInstance(fixtures, 'code-reader', { host: 'github.gmarket.com' })?.instanceName)
      .toBe('github-enterprise');
  });

  it('매칭 없으면 null 반환', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'unknown_db' })).toBeNull();
  });

  it('role 미지원 인스턴스는 제외', () => {
    // devdb-nautomaildb는 db-stored-proc 역할 없음
    expect(resolveInstance(fixtures, 'db-stored-proc', { database: 'nautomaildb' })).toBeNull();
  });
});

describe('mcpToolPrefix', () => {
  it('tool 이름으로 prefix 생성', () => {
    expect(mcpToolPrefix(fixtures[0])).toBe('mcp__oracle__');
    expect(mcpToolPrefix(fixtures[1])).toBe('mcp__devdb__');
  });
});
```

- [ ] **Step 5: 테스트 실패 확인**

```bash
cd ~/lab/local-wiki
pnpm test:unit 2>&1 | tail -5
```

Expected: `Cannot find module '../mcp-instance-registry'`

- [ ] **Step 6: mcp-instance-registry.ts 구현**

`src/lib/mcp-instance-registry.ts`:

```typescript
export type McpRole = 'db-schema' | 'db-stored-proc' | 'db-query' | 'code-reader';

export interface McpInstanceScope {
  databases?: string[];
  host?: string;
  description?: string;
}

export interface McpInstance {
  instanceName: string;
  tool: string;
  roles: McpRole[];
  scope: McpInstanceScope;
}

export function resolveInstance(
  instances: McpInstance[],
  role: McpRole,
  scope: { database?: string; host?: string },
): McpInstance | null {
  return instances.find(inst =>
    inst.roles.includes(role) &&
    (scope.database == null || (inst.scope.databases ?? []).includes(scope.database)) &&
    (scope.host == null || inst.scope.host === scope.host),
  ) ?? null;
}

export function mcpToolPrefix(instance: McpInstance): string {
  return `mcp__${instance.tool}__`;
}
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
pnpm test:unit
```

Expected:
```
✓ src/lib/__tests__/mcp-instance-registry.test.ts (6)
Test Files  1 passed (1)
Tests  6 passed (6)
```

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/lib/mcp-instance-registry.ts src/lib/__tests__/mcp-instance-registry.test.ts package.json
git commit -m "feat: mcp-instance-registry with role+scope based resolveInstance"
```

---

### Task 4: flow-catalog.ts + build-flow-prompt.ts

**Files:**
- Create: `src/lib/flow-catalog.ts`
- Create: `src/lib/build-flow-prompt.ts`
- Create: `src/lib/__tests__/build-flow-prompt.test.ts`

**Interfaces:**
- Consumes: `McpInstance`, `resolveInstance`, `mcpToolPrefix` (Task 3)
- Produces:
  - `FlowDefinition` — catalog.yaml 한 항목 타입
  - `loadCatalog(path)` → `FlowDefinition[]`
  - `buildFlowPrompt(flow, instances)` → `string`

- [ ] **Step 1: js-yaml 설치**

```bash
cd ~/lab/local-wiki
pnpm add js-yaml
pnpm add -D @types/js-yaml
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/__tests__/build-flow-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildFlowPrompt, FlowDefinition } from '../build-flow-prompt';
import { McpInstance } from '../mcp-instance-registry';

const flow: FlowDefinition = {
  id: 'F18',
  name: '링크루 메시지 발송 배치',
  repos: ['affiliate-batch'],
  entryClasses: ['LinkrewMessageRequestJobConfig', 'LinkrewMessageService'],
  tables: [
    { name: 'LINKREW_MESSAGE_REQUEST', db: 'O_GAFFILIATE' },
    { name: 'auto_linkrew_common',     db: 'nautomaildb' },
  ],
  storedProcs: [
    { name: 'UPGMKT_Affiliate_AutoLinkrewCommon_Insert', db: 'nautomaildb' },
  ],
  codeRefs: [
    { host: 'github.gmarket.com', repo: 'affiliate-batch', path: 'lib-message/src/LinkrewMessageService.java' },
  ],
};

const instances: McpInstance[] = [
  { instanceName: 'oracle-gaffiliate', tool: 'oracle',  roles: ['db-schema', 'db-stored-proc'], scope: { databases: ['O_GAFFILIATE'] } },
  { instanceName: 'devdb-nautomaildb', tool: 'devdb',   roles: ['db-schema'],                   scope: { databases: ['nautomaildb'] } },
  { instanceName: 'github-enterprise', tool: 'github',  roles: ['code-reader'],                 scope: { host: 'github.gmarket.com' } },
];

describe('buildFlowPrompt', () => {
  it('플로우명이 포함됨', () => {
    const prompt = buildFlowPrompt(flow, instances);
    expect(prompt).toContain('링크루 메시지 발송 배치');
  });

  it('oracle 인스턴스 힌트 포함', () => {
    const prompt = buildFlowPrompt(flow, instances);
    expect(prompt).toContain('O_GAFFILIATE');
    expect(prompt).toContain('mcp__oracle__');
  });

  it('devdb 인스턴스 힌트 포함', () => {
    const prompt = buildFlowPrompt(flow, instances);
    expect(prompt).toContain('nautomaildb');
    expect(prompt).toContain('mcp__devdb__');
  });

  it('MCP 없는 테이블은 폴백 메시지 포함', () => {
    const prompt = buildFlowPrompt(flow, []);  // 인스턴스 없음
    expect(prompt).toContain('MCP 미설정');
  });

  it('금지 섹션 안내 포함', () => {
    const prompt = buildFlowPrompt(flow, instances);
    expect(prompt).toContain('절대 포함 금지');
  });

  it('7개 필수 섹션 안내 포함', () => {
    const prompt = buildFlowPrompt(flow, instances);
    expect(prompt).toContain('구현 체인 완성도 표');
    expect(prompt).toContain('DB 레벨 데이터 흐름');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm test:unit 2>&1 | tail -5
```

Expected: `Cannot find module '../build-flow-prompt'`

- [ ] **Step 4: flow-catalog.ts 구현**

`src/lib/flow-catalog.ts`:

```typescript
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

export interface TableRef   { name: string; db: string; }
export interface SpRef      { name: string; db: string; }
export interface CodeRef    { host: string; repo: string; path: string; }

export interface FlowDefinition {
  id: string;
  name: string;
  repos: string[];
  entryClasses: string[];
  tables: TableRef[];
  storedProcs?: SpRef[];
  codeRefs: CodeRef[];
}

export function loadCatalog(catalogPath: string): FlowDefinition[] {
  const raw = fs.readFileSync(catalogPath, 'utf8');
  const parsed = yaml.load(raw) as { flows: FlowDefinition[] };
  return parsed.flows ?? [];
}

export function findFlow(flows: FlowDefinition[], pageId: string): FlowDefinition | null {
  // pageId 예: "f18-linkrew-messaging-batch" → id: "F18"
  return flows.find(f =>
    pageId.toLowerCase().includes(f.id.toLowerCase()) ||
    pageId.toLowerCase().includes(f.name.replace(/\s+/g, '-').toLowerCase()),
  ) ?? null;
}
```

- [ ] **Step 5: build-flow-prompt.ts 구현**

`src/lib/build-flow-prompt.ts`:

```typescript
import { McpInstance, resolveInstance, mcpToolPrefix } from './mcp-instance-registry';

export type { FlowDefinition } from './flow-catalog';
import type { FlowDefinition } from './flow-catalog';

export function buildFlowPrompt(flow: FlowDefinition, instances: McpInstance[]): string {
  const tableLines = flow.tables.map(t => {
    const inst = resolveInstance(instances, 'db-schema', { database: t.db });
    const hint = inst
      ? `→ ${mcpToolPrefix(inst)}* (${inst.instanceName})`
      : '→ (MCP 미설정 — JPA @Column 어노테이션에서 추론)';
    return `  - ${t.name} [${t.db}] ${hint}`;
  }).join('\n');

  const spLines = (flow.storedProcs ?? []).map(sp => {
    const inst = resolveInstance(instances, 'db-stored-proc', { database: sp.db });
    const hint = inst
      ? `→ ${mcpToolPrefix(inst)}* (${inst.instanceName})`
      : '→ (MCP 미설정 — @SaturnProcedure 어노테이션 파라미터 확인)';
    return `  - ${sp.name} [${sp.db}] ${hint}`;
  }).join('\n');

  const codeLines = flow.codeRefs.map(ref => {
    const inst = resolveInstance(instances, 'code-reader', { host: ref.host });
    const hint = inst
      ? `→ ${mcpToolPrefix(inst)}get_file_contents (${inst.instanceName})`
      : '→ (MCP 미설정 — codegraph_explore 사용)';
    return `  - [${ref.host}] ${ref.repo}/${ref.path} ${hint}`;
  }).join('\n');

  return `# 비즈니스 플로우 분석: ${flow.name} (${flow.id})

## 분석 대상
- 관련 레포: ${flow.repos.join(', ')}
- 진입점: ${flow.entryClasses.join(', ')}

## 컨텍스트 수집 지시 (순서대로 실행)

### 1. Call Chain
codegraph query "${flow.entryClasses.join(' ')}"

### 2. 테이블 스키마 (DB별 MCP 자동 선택)
${tableLines || '  (없음)'}

### 3. Stored Procedure
${spLines || '  (없음)'}

### 4. 소스 코드
${codeLines || '  (없음)'}

## 출력 요구사항

아래 7개 섹션을 **모두** 포함한 마크다운 문서를 작성하라.

1. **개요** — 목적(1문장), 관련 모듈, 주요 히스토리
2. **워크플로우** — mermaid sequenceDiagram, participant에 DB 테이블명 포함
3. **DB 레벨 데이터 흐름** ★ 없으면 미완성
   - 관련 테이블 전체 맵: \`| 테이블명 | DB종류 | 역할 |\`
   - 단계별 SQL 흐름: STEP 1~N 각각 실제 SELECT/INSERT/UPDATE/EXEC
   - 전체 처리 순서 요약: \`[DB] TABLE ← 작업\` 형식
   - 테이블 참조 관계 (텍스트 ERD)
4. **핵심 컴포넌트** — 클래스.메서드(), 파일경로:라인
5. **구현 체인 완성도 표** — \`| # | 컴포넌트 | 파일경로:라인 | 상태(✅/🔧/❌) |\`
6. **예외 처리** — 실패 시 DB 상태, 재시도 여부
7. **도메인 지식 Q&A** — 비직관적 규칙, 코드 스니펫

## 절대 포함 금지
로컬 개발 이슈, 기동 순서, Docker/k8s, 배포 관련

## SQL 작성 기준
- 실제 컬럼명만 사용 (추측 금지)
- 확인 불가: \`-- ※ MCP 미연결: 수동 확인 필요\`
- JPA 메서드: \`-- JPA: methodName(param)\`
`;
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm test:unit
```

Expected:
```
✓ src/lib/__tests__/mcp-instance-registry.test.ts (6)
✓ src/lib/__tests__/build-flow-prompt.test.ts (6)
Test Files  2 passed (2)
Tests  12 passed (12)
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/flow-catalog.ts src/lib/build-flow-prompt.ts src/lib/__tests__/build-flow-prompt.test.ts
git commit -m "feat: flow-catalog loader and build-flow-prompt with instance-aware context"
```

---

### Task 5: wiki-generator.ts — per-flow 페이지 생성

Business Flows 섹션 페이지 감지 → catalog에서 플로우 매핑 → `buildFlowPrompt()` 로 프롬프트 교체.

**Files:**
- Modify: `src/lib/wiki-generator.ts`

**Injection point:** `generateOnePage()` 내부, line 1596 `${buildMcpContextForPage(page)}` 직후, `const pageReqBody =` (line 1609) 직전.

- [ ] **Step 1: wiki-generator.ts 상단 import 추가**

`src/lib/wiki-generator.ts` 파일 상단 import 블록(line 1 근처)에 추가:

```typescript
import { loadCatalog, findFlow } from './flow-catalog';
import { buildFlowPrompt } from './build-flow-prompt';
import type { McpInstance } from './mcp-instance-registry';
import path from 'path';
import fs from 'fs';
```

- [ ] **Step 2: mcpInstances 로드 헬퍼 추가**

`generateOnePage` 함수 정의(line ~1544) 바로 위에 삽입:

```typescript
function loadFlowsConfig(projectPath: string): McpInstance[] {
  const configPath = path.join(path.dirname(new URL(import.meta.url).pathname), '../../flows/local-wiki.flows.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw).mcpInstances ?? [];
  } catch {
    return [];
  }
}

function isBusinessFlowPage(page: { id: string; title: string }): boolean {
  const id = page.id.toLowerCase();
  const title = page.title.toLowerCase();
  return id.includes('business-flow') || id.startsWith('f0') || id.startsWith('f1') ||
    title.includes('business flow') || title.includes('비즈니스 플로우');
}
```

- [ ] **Step 3: generateOnePage 내 프롬프트 교체 로직 삽입**

`src/lib/wiki-generator.ts` line 1596-1608 영역(STRICT_FORMAT_RULES 직후, `const pageReqBody =` 직전)에 삽입:

```typescript
      // ── Business Flow 페이지: catalog 기반 enriched prompt 교체 ──────────
      const catalogPath = path.join(projectPath, '../flows/catalog.yaml');
      if (isBusinessFlowPage(page) && fs.existsSync(catalogPath)) {
        const flows = loadCatalog(catalogPath);
        const flow = findFlow(flows, page.id);
        if (flow) {
          const mcpInstances = loadFlowsConfig(projectPath);
          pagePrompt = buildFlowPrompt(flow, mcpInstances);
          await emitStep(streamId, 'agent_log', 'generation',
            `🗄️ "${page.title}" — catalog 기반 flow prompt 적용 (${flow.id})`);
        }
      }
      // ──────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: 수동 검증 — wiki-generator 실행**

로컬 local-wiki 서버 시작 후 affiliate 프로젝트 위키 생성:
1. `~/work/martech/affiliate`를 대상으로 위키 생성 트리거
2. 생성 로그에서 `🗄️ ... catalog 기반 flow prompt 적용` 메시지 확인
3. 생성된 Business Flows 페이지 중 하나를 열어 "DB 레벨 데이터 흐름" 섹션 존재 확인

- [ ] **Step 5: Commit**

```bash
git add src/lib/wiki-generator.ts
git commit -m "feat: wiki-generator per-flow page generation from catalog with enriched prompt"
```

---

### Task 6: local-wiki.flows.json — mcpInstances 설정 파일

**Files:**
- Create: `flows/local-wiki.flows.example.json` (커밋됨)
- Create: `flows/local-wiki.flows.json` (gitignore, 사용자 로컬)
- Modify: `.gitignore`

- [ ] **Step 1: .gitignore에 추가**

`.gitignore`에 추가:
```
flows/local-wiki.flows.json
```

- [ ] **Step 2: example 파일 작성**

`flows/local-wiki.flows.example.json`:

```json
{
  "_comment": "이 파일을 local-wiki.flows.json으로 복사하고 환경에 맞게 수정하세요.",
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
      "instanceName": "github-enterprise",
      "tool": "github",
      "roles": ["code-reader"],
      "scope": {
        "host": "github.gmarket.com",
        "description": "사내 GitHub Enterprise"
      }
    }
  ]
}
```

- [ ] **Step 3: 로컬 설정 파일 생성 (커밋 안 함)**

```bash
cp flows/local-wiki.flows.example.json flows/local-wiki.flows.json
# 실제 환경에 맞게 tool 이름, host, databases 값 수정
```

- [ ] **Step 4: Commit**

```bash
git add flows/local-wiki.flows.example.json .gitignore
git commit -m "feat: add local-wiki.flows.json config for MCP instance mapping"
```

---

### Task 7: Layer B — Go analyze-flow 커맨드

단일 플로우를 CLI에서 분석하여 markdown 파일로 저장.

**Files:**
- Create: `agent/internal/flowanalyzer/analyzer.go`
- Create: `agent/internal/flowanalyzer/analyzer_test.go`
- Modify: `agent/cmd/localwiki-agent/main.go`

**Interfaces:**
- Consumes: `runner.Registry` (기존), `catalog.yaml`, `local-wiki.flows.json`
- Produces: `<out-dir>/f18-linkrew-messaging-batch.md`

- [ ] **Step 1: analyzer_test.go 먼저 작성 (TDD)**

`agent/internal/flowanalyzer/analyzer_test.go`:

```go
package flowanalyzer_test

import (
	"strings"
	"testing"

	"github.com/localwiki/agent/internal/flowanalyzer"
)

func TestBuildPrompt_ContainsFlowName(t *testing.T) {
	flow := flowanalyzer.FlowDef{
		ID:   "F18",
		Name: "링크루 메시지 발송 배치",
		EntryClasses: []string{"LinkrewMessageRequestJobConfig"},
		Tables: []flowanalyzer.TableRef{{Name: "LINKREW_MESSAGE_REQUEST", DB: "O_GAFFILIATE"}},
		CodeRefs: []flowanalyzer.CodeRef{{Host: "github.gmarket.com", Repo: "affiliate-batch", Path: "LinkrewMessageService.java"}},
	}
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"O_GAFFILIATE"}}},
	}

	prompt := flowanalyzer.BuildPrompt(flow, instances)

	if !strings.Contains(prompt, "링크루 메시지 발송 배치") {
		t.Error("프롬프트에 플로우명이 없음")
	}
	if !strings.Contains(prompt, "mcp__oracle__") {
		t.Error("프롬프트에 oracle MCP 힌트가 없음")
	}
	if !strings.Contains(prompt, "DB 레벨 데이터 흐름") {
		t.Error("프롬프트에 DB 레벨 섹션 요구사항이 없음")
	}
}

func TestResolveInstance_MatchByDB(t *testing.T) {
	instances := []flowanalyzer.MCPInstance{
		{InstanceName: "oracle-main", Tool: "oracle", Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"O_GAFFILIATE"}}},
		{InstanceName: "devdb-mssql", Tool: "devdb",  Roles: []string{"db-schema"}, Scope: flowanalyzer.Scope{Databases: []string{"nautomaildb"}}},
	}

	got := flowanalyzer.ResolveInstance(instances, "db-schema", "O_GAFFILIATE", "")
	if got == nil || got.InstanceName != "oracle-main" {
		t.Errorf("expected oracle-main, got %v", got)
	}

	got2 := flowanalyzer.ResolveInstance(instances, "db-schema", "unknown", "")
	if got2 != nil {
		t.Error("unknown db는 nil이어야 함")
	}
}
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd ~/lab/local-wiki/agent
go test ./internal/flowanalyzer/... 2>&1 | head -5
```

Expected: `cannot find package "github.com/localwiki/agent/internal/flowanalyzer"`

- [ ] **Step 3: analyzer.go 구현**

`agent/internal/flowanalyzer/analyzer.go`:

```go
package flowanalyzer

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// ── 타입 정의 ────────────────────────────────────────────────────────────────

type TableRef struct {
	Name string `yaml:"name"`
	DB   string `yaml:"db"`
}

type SpRef struct {
	Name string `yaml:"name"`
	DB   string `yaml:"db"`
}

type CodeRef struct {
	Host string `yaml:"host"`
	Repo string `yaml:"repo"`
	Path string `yaml:"path"`
}

type FlowDef struct {
	ID           string     `yaml:"id"`
	Name         string     `yaml:"name"`
	Repos        []string   `yaml:"repos"`
	EntryClasses []string   `yaml:"entryClasses"`
	Tables       []TableRef `yaml:"tables"`
	StoredProcs  []SpRef    `yaml:"storedProcs"`
	CodeRefs     []CodeRef  `yaml:"codeRefs"`
}

type Scope struct {
	Databases []string `json:"databases"`
	Host      string   `json:"host"`
}

type MCPInstance struct {
	InstanceName string   `json:"instanceName"`
	Tool         string   `json:"tool"`
	Roles        []string `json:"roles"`
	Scope        Scope    `json:"scope"`
}

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

func LoadCatalog(path string) ([]FlowDef, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data struct {
		Flows []FlowDef `yaml:"flows"`
	}
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return nil, err
	}
	return data.Flows, nil
}

func FindFlow(flows []FlowDef, id string) *FlowDef {
	upper := strings.ToUpper(id)
	for i := range flows {
		if flows[i].ID == upper {
			return &flows[i]
		}
	}
	return nil
}

func ResolveInstance(instances []MCPInstance, role, database, host string) *MCPInstance {
	for i := range instances {
		inst := &instances[i]
		if !containsStr(inst.Roles, role) {
			continue
		}
		if database != "" && !containsStr(inst.Scope.Databases, database) {
			continue
		}
		if host != "" && inst.Scope.Host != host {
			continue
		}
		return inst
	}
	return nil
}

func containsStr(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}

// ── 프롬프트 빌더 ────────────────────────────────────────────────────────────

func BuildPrompt(flow FlowDef, instances []MCPInstance) string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "# 비즈니스 플로우 분석: %s (%s)\n\n", flow.Name, flow.ID)
	fmt.Fprintf(&sb, "## 분석 대상\n- 관련 레포: %s\n- 진입점: %s\n\n",
		strings.Join(flow.Repos, ", "), strings.Join(flow.EntryClasses, ", "))

	sb.WriteString("## 컨텍스트 수집 지시\n\n")
	fmt.Fprintf(&sb, "### 1. Call Chain\ncodegraph query \"%s\"\n\n", strings.Join(flow.EntryClasses, " "))

	sb.WriteString("### 2. 테이블 스키마\n")
	for _, t := range flow.Tables {
		inst := ResolveInstance(instances, "db-schema", t.DB, "")
		if inst != nil {
			fmt.Fprintf(&sb, "  - %s [%s] → mcp__%s__* (%s)\n", t.Name, t.DB, inst.Tool, inst.InstanceName)
		} else {
			fmt.Fprintf(&sb, "  - %s [%s] → (MCP 미설정 — JPA 어노테이션 확인)\n", t.Name, t.DB)
		}
	}

	if len(flow.StoredProcs) > 0 {
		sb.WriteString("\n### 3. Stored Procedure\n")
		for _, sp := range flow.StoredProcs {
			inst := ResolveInstance(instances, "db-stored-proc", sp.DB, "")
			if inst != nil {
				fmt.Fprintf(&sb, "  - %s [%s] → mcp__%s__* (%s)\n", sp.Name, sp.DB, inst.Tool, inst.InstanceName)
			} else {
				fmt.Fprintf(&sb, "  - %s [%s] → (MCP 미설정)\n", sp.Name, sp.DB)
			}
		}
	}

	sb.WriteString("\n### 4. 소스 코드\n")
	for _, ref := range flow.CodeRefs {
		inst := ResolveInstance(instances, "code-reader", "", ref.Host)
		if inst != nil {
			fmt.Fprintf(&sb, "  - [%s] %s/%s → mcp__%s__get_file_contents (%s)\n",
				ref.Host, ref.Repo, ref.Path, inst.Tool, inst.InstanceName)
		} else {
			fmt.Fprintf(&sb, "  - [%s] %s/%s → (MCP 미설정 — codegraph_explore)\n",
				ref.Host, ref.Repo, ref.Path)
		}
	}

	sb.WriteString(`
## 출력 요구사항 (7개 섹션 필수)

1. **개요** — 목적(1문장), 관련 모듈, 주요 히스토리
2. **워크플로우** — mermaid sequenceDiagram, DB participant 포함
3. **DB 레벨 데이터 흐름** ★ 없으면 미완성
   - 테이블 전체 맵, 단계별 SQL, 전체 순서 요약, ERD
4. **핵심 컴포넌트** — 클래스.메서드(), 파일경로:라인
5. **구현 체인 완성도 표** — | # | 컴포넌트 | 파일경로:라인 | 상태 |
6. **예외 처리**
7. **도메인 지식 Q&A**

## 절대 포함 금지
로컬 개발 이슈, 기동 순서, Docker/k8s, 배포 관련
`)
	return sb.String()
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd ~/lab/local-wiki/agent
go test ./internal/flowanalyzer/... -v 2>&1 | tail -10
```

Expected:
```
--- PASS: TestBuildPrompt_ContainsFlowName (0.00s)
--- PASS: TestResolveInstance_MatchByDB (0.00s)
PASS
ok  github.com/localwiki/agent/internal/flowanalyzer
```

- [ ] **Step 5: main.go에 analyze-flow 커맨드 추가**

`agent/cmd/localwiki-agent/main.go`의 `switch os.Args[1]` 블록에 추가:

```go
case "analyze-flow":
    os.Exit(cmdAnalyzeFlow(os.Args[2:]))
```

그리고 `printUsage()` 아래에 `cmdAnalyzeFlow` 함수 추가:

```go
func cmdAnalyzeFlow(args []string) int {
	fs := flag.NewFlagSet("analyze-flow", flag.ExitOnError)
	flowID      := fs.String("flow", "", "플로우 ID (예: F18)")
	catalogPath := fs.String("catalog", "flows/catalog.yaml", "catalog.yaml 경로")
	configPath  := fs.String("config", "flows/local-wiki.flows.json", "MCP 인스턴스 설정 파일")
	agent       := fs.String("agent", "claude", "사용할 AI 에이전트 (claude/gemini/codex)")
	outDir      := fs.String("out", ".", "출력 디렉토리")
	_ = fs.Parse(args)

	if *flowID == "" {
		fmt.Fprintln(os.Stderr, "ERROR: --flow 필수 (예: --flow F18)")
		return 1
	}

	flows, err := flowanalyzer.LoadCatalog(*catalogPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: catalog 로드 실패: %v\n", err)
		return 1
	}

	flow := flowanalyzer.FindFlow(flows, *flowID)
	if flow == nil {
		fmt.Fprintf(os.Stderr, "ERROR: 플로우 %q 를 catalog에서 찾을 수 없음\n", *flowID)
		return 1
	}

	var instances []flowanalyzer.MCPInstance
	if raw, err := os.ReadFile(*configPath); err == nil {
		var cfg struct {
			MCPInstances []flowanalyzer.MCPInstance `json:"mcpInstances"`
		}
		if err := json.Unmarshal(raw, &cfg); err == nil {
			instances = cfg.MCPInstances
		}
	}

	prompt := flowanalyzer.BuildPrompt(*flow, instances)

	r, err := runner.Lookup(*agent)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: 에이전트 %q 없음: %v\n", *agent, err)
		return 1
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	result, err := r.Run(ctx, runner.RunOptions{Prompt: prompt})
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: 분석 실패: %v\n", err)
		return 1
	}

	slug := strings.ToLower(strings.ReplaceAll(flow.Name, " ", "-"))
	outPath := filepath.Join(*outDir, fmt.Sprintf("%s-%s.md", strings.ToLower(flow.ID), slug))
	if err := os.WriteFile(outPath, []byte(result), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: 파일 저장 실패: %v\n", err)
		return 1
	}

	fmt.Printf("✅ %s → %s\n", flow.Name, outPath)
	return 0
}
```

필요한 import 추가 (`main.go` import 블록):
```go
import (
    // 기존 import 유지
    "encoding/json"
    "path/filepath"

    "github.com/localwiki/agent/internal/flowanalyzer"
)
```

- [ ] **Step 6: 빌드 확인**

```bash
cd ~/lab/local-wiki/agent
go build ./... 2>&1
```

Expected: 오류 없음

- [ ] **Step 7: F18 수동 실행 테스트**

```bash
cd ~/lab/local-wiki
./agent/localwiki-agent analyze-flow \
  --flow F18 \
  --catalog flows/catalog.yaml \
  --config flows/local-wiki.flows.json \
  --agent claude \
  --out /tmp/flow-test/
```

Expected: `/tmp/flow-test/f18-링크루-메시지-발송-배치.md` 생성 확인.  
생성된 파일에서 "DB 레벨 데이터 흐름" 섹션과 SQL이 있는지 확인.

- [ ] **Step 8: Commit**

```bash
cd ~/lab/local-wiki/agent
go test ./... 2>&1 | tail -5
cd ..
git add agent/internal/flowanalyzer/ agent/cmd/localwiki-agent/main.go
git commit -m "feat: Layer B analyze-flow CLI command with catalog + MCP instance config"
```

---

## 자가 검토 결과

**Spec coverage:**
- Layer C 프롬프트 스펙 → Task 1 ✅
- catalog.yaml 19개 플로우 → Task 2 ✅
- McpInstance 타입 + resolveInstance → Task 3 ✅
- buildFlowPrompt (역할+scope 기반) → Task 4 ✅
- wiki-generator per-flow 주입 → Task 5 ✅
- local-wiki.flows.json 설정 → Task 6 ✅
- Go analyze-flow 커맨드 → Task 7 ✅
- 금지 섹션 / DB SQL 필수 요구 → Task 1, 4, 7 프롬프트에 모두 포함 ✅
- MCP 비가용 폴백 → Task 3 `resolveInstance` null 처리, Task 4 폴백 문자열 ✅

**타입 일관성:**
- `FlowDefinition` — flow-catalog.ts에서 정의, build-flow-prompt.ts에서 re-export
- `McpInstance` — mcp-instance-registry.ts에서 정의, 모든 파일에서 동일 타입 참조
- Go `FlowDef` / `MCPInstance` — flowanalyzer 패키지 내부 일관

**Placeholder 없음:** 확인 ✅
