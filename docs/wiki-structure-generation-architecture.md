# Wiki 구조 생성 아키텍처 리뷰

## 배경: 반복된 파싱 실패

### 증상

멀티 프로젝트 레포(예: affiliate 시스템, 6개 서브프로젝트)에서 위키 생성 시 아래 에러가 반복 발생:

```
Error: 위키 구조 파싱 실패: AI 응답에서 JSON 없음 (14035자):
{
  "title": "Affiliate System Wiki",
  "rootSections": [
    "affiliate-admin",
    "affiliate-backend",
    "affiliate-batch",
    "affiliate-event",
    "affiliate-frontend      ← 여기서 잘림 (닫는 따옴표 없음)
```

### 패치의 악순환

이 문제를 해결하려는 이전 시도들:

| 시도 | 수정 내용 | 결과 |
|------|----------|------|
| 1차 | `filePaths` 금지 — "generate accurate filePaths" → "do NOT add filePaths" | agy 출력 축소, 일부 해결 |
| 2차 | `extractJson()` bracket-counting repair 추가 | 작은 truncation 복구 가능 |
| 3차 | `inString ? '":null' : ''` → try `'"'` first | 배열 값 위치 mid-string 복구 |

각 패치 이후 새로운 프로젝트에서 다시 실패. **패치는 truncation 증상을 치료했지, 원인을 치료하지 않았다.**

---

## 근본 원인 분석

### agy(antigravity)의 출력 한계

`api/chat/provider_dispatcher.py`:

```python
_AGY_TOKEN_HARD_LIMIT = 12000  # 입력 토큰 한도
```

그러나 문제는 **출력** 토큰 한도다. agy는 Gemini Flash 기반이며 effective output limit은 **약 3K~4.5K tokens** (~12K~18K chars). 14,035자 응답이 생성되려면 이 한계를 초과한다.

### 왜 멀티 프로젝트에서만 실패했나

6개 서브프로젝트 기준으로 LLM이 생성해야 할 JSON 최소 크기:

```
rootSections: 8개 항목
sections: 9개 (system-overview + business-flows + 6 subsystems + cross-cutting)
  각 section마다 3~5개 page ID
pages: ~25개 오브젝트 ({id, title})
  각 page 평균 50자
총합: 약 3,000~5,000자 (최소)
```

LLM이 description, 추가 필드 등을 덧붙이면 14K자까지 불어난다.

### 왜 "패치"가 근본 해결이 아니었나

```
[설계 가정]  LLM이 완전한 JSON을 반환한다
     ↓
[현실]       JSON이 중간에 잘린다
     ↓
[패치 접근]  잘린 JSON을 복구하려 한다
     ↓
[문제]       복구 가능한 truncation 패턴은 유한하고
             LLM은 항상 새로운 방식으로 자른다
```

핵심: **LLM이 멀티 프로젝트 구조를 생성할 이유가 없다.** 이 시점에는 이미 모든 정보가 있다:
- `subsystems[]` — Phase 2a에서 탐지 완료
- `catalogFlows[]` — catalog.yaml에서 이미 조회 완료
- 섹션 구조 패턴 — 고정 (system-overview → business-flows → 각 subsystem → cross-cutting)

---

## 아키텍처 변경

### 이전 설계: LLM-Dependent Structure

```
Phase 2a: subsystems 탐지 (LLM 호출 1)
     ↓
Phase 2b: 전체 위키 구조 JSON 생성 요청 (LLM 호출 2)  ← 실패 지점
     ↓
extractJson(): 응답에서 JSON 추출
     ↓
repair(): truncation 복구 시도
     ↓
실패 시 재시도 (LLM 호출 3)
     ↓
재실패 시 에러 throw
```

**문제**: 프로젝트가 클수록 JSON이 커지고 → truncation 가능성 증가 → 실패율 증가

### 새 설계: Deterministic Structure for Multi-Project

```
Phase 2a: subsystems 탐지 (LLM 호출 1)
     ↓
Multi-project 분기 (subsystems.length >= 2)
     ↓
_buildMultiProjectStructure(repo, subsystems, catalogFlows)  ← 순수 TypeScript 함수
     ↓
_normalizeStructureIds()  ← kebab-case 정규화
     ↓
_inferPageFilePaths()  ← 경로 추론
     ↓ (LLM 호출 없음)
wikiStructure 완성
```

**단일 책임 원칙 준수**: 각 단계가 하나의 책임만 가짐
- Phase 2a LLM: "각 디렉토리가 어떤 프로젝트인가?" (subsystems 탐지)
- `_buildMultiProjectStructure`: "알려진 subsystems로 구조를 만든다" (순수 함수)

### `_buildMultiProjectStructure` 함수 설계

```typescript
function _buildMultiProjectStructure(
  repo: string,
  subsystems: Array<{ id: string; name: string; paths: string[] }>,
  catalogFlows: Array<{ id: string; name: string }>,
): any
```

**입력 → 출력 매핑 (결정론적)**:

| 입력 | 출력에서의 역할 |
|------|----------------|
| `subsystems[i].id` | sections[i].id, pages의 `{id}-api`, `{id}-domain`, `{id}-architecture` |
| `subsystems[i].name` | sections[i].title, pages의 title prefix |
| `catalogFlows.length > 0` | `business-flows` 섹션 포함 여부, `business-flow` 페이지 제거 여부 |
| `repo` | `title: "{repo} Wiki"` |

**생성 구조 (affiliate 6개 서브프로젝트 예시)**:

```
rootSections: [
  "system-overview",
  "business-flows",         ← catalogFlows 있을 때만
  "affiliate-admin",
  "affiliate-backend",
  "affiliate-batch",
  "affiliate-event",
  "affiliate-frontend",
  "affiliate-gateway",
  "cross-cutting"
]

sections: [
  { id: "system-overview",  pages: ["service-map", "data-flow"] },
  { id: "business-flows",   pages: [] },  ← post-processing에서 catalog로 채움
  { id: "affiliate-admin",  pages: ["affiliate-admin-api", "affiliate-admin-domain", "affiliate-admin-architecture"] },
  ... (각 subsystem 동일 패턴)
  { id: "cross-cutting",    pages: ["auth", "observability", "error-handling"] }
]
```

---

## 데이터 플로우 비교

### Before

```
File Tree + README
      │
      ▼
[LLM Phase 2a]  ──→  subsystems[]
      │
      ▼
[LLM Phase 2b]  ──→  JSON (14K+ chars, 잘릴 수 있음)
      │
      ▼
extractJson()   ──→  성공 or null
      │
    null일 때
      │
      ▼
repair()        ──→  성공 or null
      │
    null일 때
      │
      ▼
재시도 LLM      ──→  성공 or 에러 throw  ← 여기서 실패
```

### After

```
File Tree + README
      │
      ▼
[LLM Phase 2a]  ──→  subsystems[]
      │
catalog.yaml    ──→  catalogFlows[]
      │
      ▼  (multi-project일 때)
_buildMultiProjectStructure()  ──→  wikiStructure  (항상 성공)
      │
      ▼  (그 외 타입)
[LLM Phase 2b]  ──→  extractJson() → repair() → 재시도
```

---

## 영향 범위

### 변경된 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/lib/wiki-generator.ts` | `_buildMultiProjectStructure()` 함수 추가 (line 821~866) |
| `src/lib/wiki-generator.ts` | Phase 2b 진입 전 multi-project 분기 추가 (line 1386~1395) |
| `src/lib/wiki-generator.ts` | `extractJson()` repair 로직 개선 — `inString` 시 `'"'` 우선 시도 |

### 변경되지 않은 것

- 일반 타입 (`backend-api`, `frontend-web`, `general` 등): LLM Phase 2b 경로 그대로
- Phase 2a (subsystems 탐지): 변경 없음
- Business-flows post-processing (catalog에서 pages 재구성): 변경 없음
- `_inferPageFilePaths()` 호출: deterministic path에서도 동일하게 실행됨

### 성능 영향

| 항목 | Before | After |
|------|--------|-------|
| Phase 2b LLM 호출 횟수 (multi-project) | 1~2회 (실패 시 재시도) | 0회 |
| Phase 2b 소요 시간 (multi-project) | 10~30초 | ~0ms |
| 파싱 실패율 (multi-project, 5개+ 서브프로젝트) | 높음 (LLM 출력 한계 초과) | 0% |

---

## 한계 및 트레이드오프

### LLM-generated titles 미사용

기존 방식에서는 LLM이 섹션/페이지 제목을 도메인에 맞게 생성했다. 예:
- LLM: `"Affiliate Admin — 어드민 관리 API"` (컨텍스트 반영)
- Deterministic: `"Affiliate Admin — API Contract"` (템플릿)

**실제 영향**: Phase 4 (개별 페이지 생성)에서 LLM이 실제 컨텐츠를 생성할 때 파일 트리와 소스를 분석하므로, 구조 제목이 템플릿이어도 콘텐츠 품질은 동일하다.

### 고정 섹션 패턴

멀티 프로젝트는 항상 `api + domain + architecture` 3개 페이지로 구성된다. 특수한 프로젝트 (예: 라이브러리 모음, 데이터 파이프라인 집합)에서는 맞지 않을 수 있다.

**현재 허용 범위**: 빌드 파일(`pom.xml`, `build.gradle`, `go.mod`) 기반으로 서브프로젝트를 탐지하므로, 이 패턴이 맞는 프로젝트(서비스 단위 멀티 모듈)에만 적용된다.

---

## 결론

**이전 설계의 근본 문제**: "LLM이 알고 있는 정보를 JSON으로 출력해줄 것이다"라는 가정. 그러나 LLM은 출력 크기 한계가 있고, 특히 agy(Gemini Flash 기반)는 구조화 JSON 생성에서 이 한계가 자주 발생한다.

**새 설계의 원칙**: "LLM은 발견(discovery)에만 사용하고, 이미 알고 있는 것은 코드로 조립한다."
- LLM Phase 2a: "이 디렉토리들이 어떤 역할을 하는가?" → subsystems 탐지
- TypeScript `_buildMultiProjectStructure`: "알려진 subsystems로 구조를 만든다" → 결정론적

이 원칙을 다른 타입(backend-api, frontend-web 등)으로 확장하면 전체 위키 생성의 안정성이 한층 더 높아질 수 있다.
