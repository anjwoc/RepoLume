# LocalWiki Analysis Pipeline

## Architecture Overview

LocalWiki uses an EDA (Event-Driven Architecture) pipeline. Every phase emits structured events through `TaskStreamManager`, which simultaneously broadcasts via SSE to the frontend and persists to SQLite. This means real-time progress display and post-run log replay both use the same event store.

```
wiki-generator.ts (TypeScript orchestrator)
  │  emits task events via fetch → /api/task/event
  │
  ▼
TaskStreamManager (Python, api/task_stream.py)
  ├── SSE broadcast → /api/task/stream/:stream_id  (real-time frontend)
  └── SQLite persist → EventStore (api/db/event_store.py) for replay
```

## Pipeline Phases

| # | ID | Name | MCP Required | Description |
|---|----|----|---|---|
| 1 | `scan` | 파일 스캔 | No | Read project file tree via `/local_repo/structure` |
| 1.5 | `scan` | 프로젝트 분류 | No | Heuristic classification (no LLM call) |
| 2 | `structure` | AI 구조 생성 | No | LLM generates wiki section/page structure |
| 2.5 | `extract` | 엔티티 추출 | **Yes** | Extract DB tables, stored procedures, service names from code |
| 3 | `mcp` | MCP 크로스체크 | **Yes** | Query active MCP sources for real schema/issue data |
| 4 | `generation` | 페이지 생성 | No | LLM writes each page (with MCP context injected if available) |
| 4.5 | `synthesis` | 종합 인사이트 | No | Generate Business Flow, Data Flow, Impact analysis pages |
| 5 | `save` | 캐시 저장 | No | Persist wiki to SQLite cache |

Phases 2.5 and 3 run **only when at least one MCP provider is enabled** in settings. When no MCPs are configured, the pipeline skips directly from `structure` to `generation` — no API calls are made, no events are emitted for those phases.

## Dynamic Pipeline Composition

```
MCP disabled (default):
  scan → structure → generation → synthesis → save

MCP enabled (≥1 provider active):
  scan → structure → extract → mcp → generation → synthesis → save
                                          ↑
                               <mcp_context> injected into each page prompt
```

The pipeline auto-detects MCP status at startup by reading `/api/settings/mcp_settings`. No manual flag needed — enabling a provider in Settings activates the phases automatically on the next analysis run.

## MCP Integration

### Configuration Flow

```
Settings UI
  → PUT /api/settings/mcp_settings
      → SQLite (persists for UI reload)
      → ~/.localwiki/mcp-config.yaml (sync via pyyaml, non-fatal on error)
          → MCPManager.from_config() (reads YAML at pipeline start)
```

The YAML bridge (`api/routes/config.py: _mcp_settings_to_yaml`) handles all provider types:

| UI Provider Type | YAML Section | Notes |
|---|---|---|
| `postgresql`, `mysql`, `mssql`, `oracle`, `mariadb`, `mongodb` | `databases.<type>` | Uses `config.dbUrl` |
| `github` | `github` | Token + optional `base_url` for GHE |
| `jira` + `confluence` | `atlassian` | Single section, datacenter mode |
| custom (`edition: "custom"`) | `custom_mcps.<id>` | Uses `customCommand` |

### Phase 2.5 — Entity Extraction

Calls `/api/code/extract-entities` with the list of file paths from the wiki structure. Returns:
- `db_tables` — table names referenced in code
- `stored_procs` — stored procedure names
- `service_names` — internal service/module names

These entities are passed to Phase 3 as search keys for MCP reverse-lookup.

### Phase 3 — MCP Cross-Check

Calls `/api/mcp/collect` with the extracted entities. `MCPManager` dispatches queries to each active provider:
- **DB providers** — query actual schema for matched table/procedure names
- **GitHub** — search issues/PRs mentioning the entities
- **Atlassian** — search Jira issues and Confluence pages

Results are merged into `mcpContext: Record<string, string>` keyed by provider name.

### MCP Context Injection (Phase 4)

Each page prompt receives MCP results wrapped in XML:

```
<mcp_context source="oracle">
  TABLE: ORDER_MASTER — columns: ORDER_ID, STATUS, CREATED_AT, ...
</mcp_context>

<mcp_context source="github">
  Issue #1234: [BUG] ORDER_MASTER deadlock on high concurrency
</mcp_context>
```

The LLM uses this to write pages grounded in actual schema/issue data rather than inferred structure.

## Event Reference

### EventType

| Constant | Value | Emitted When |
|---|---|---|
| `PIPELINE_STARTED` | `pipeline.started` | `runWikiGeneration` begins |
| `PIPELINE_COMPLETED` | `pipeline.completed` | All phases complete successfully |
| `PIPELINE_FAILED` | `pipeline.failed` | Unrecoverable error |
| `PHASE_STARTED` | `phase.started` | Phase begins |
| `PHASE_COMPLETED` | `phase.completed` | Phase finishes |
| `PHASE_FAILED` | `phase.failed` | Phase error |
| `PAGE_STARTED` | `page.started` | LLM starts writing a wiki page |
| `PAGE_COMPLETED` | `page.completed` | Page write complete |
| `PAGE_FAILED` | `page.failed` | Page write error |
| `AGENT_REQUEST` | `agent.request` | LLM prompt sent |
| `AGENT_CHUNK` | `agent.chunk` | Streaming token received |
| `AGENT_RESPONSE` | `agent.response` | LLM response complete |
| `AGENT_ERROR` | `agent.error` | LLM error |
| `ENTITY_EXTRACTED` | `entity.extracted` | Phase 2.5 entity extraction complete |
| `MCP_QUERIED` | `mcp.queried` | MCP provider query sent |
| `MCP_RESPONDED` | `mcp.responded` | MCP provider returned data |
| `MCP_SKIPPED` | `mcp.skipped` | MCP provider inactive or no matching entities |
| `HEARTBEAT` | `heartbeat` | SSE keep-alive (every 15s) |
| `ERROR` | `error` | General error |
| `COMPLETE` | `complete` | Stream complete signal |

### PhaseType

| Constant | Value |
|---|---|
| `SCAN` | `scan` |
| `STRUCTURE` | `structure` |
| `EXTRACT` | `extract` |
| `MCP` | `mcp` |
| `GENERATION` | `generation` |
| `SYNTHESIS` | `synthesis` |
| `SAVE` | `save` |

### Event Data Fields

```typescript
interface PipelineEvent {
  id: number          // auto-increment from SQLite
  type: EventType     // one of the constants above
  stream_id: string   // UUID identifying the analysis run
  ts: string          // ISO timestamp
  phase?: PhaseType   // which phase emitted this event
  message: string     // human-readable log line
  data: Record<string, unknown>  // phase-specific payload
}
```

## Running Without MCP (Zero Config)

LocalWiki works fully without any MCP configuration. The pipeline runs phases 1, 1.5, 2, 4, 4.5, and 5. Output quality is based on static code analysis only — no real-time schema or issue data.

To verify MCP is inactive: check `~/.localwiki/mcp-config.yaml` does not exist or has all providers set to `enabled: false`.

## Supported MCP Providers

| Provider | Data Retrieved | Setup Required |
|---|---|---|
| PostgreSQL / MySQL / MariaDB / MongoDB | Table schema, column types | Database connection string |
| MSSQL / Oracle | Table schema, stored procedures | Database connection string |
| GitHub | Issues, PRs, code search | Personal access token |
| Jira | Issues, epics, linked items | Atlassian datacenter URL + PAT |
| Confluence | Page content, space search | Atlassian datacenter URL |
| Custom MCP | Defined by `customCommand` | Command must be executable |

Configure all providers via the Settings page (`/settings` → MCP 연동 탭).
