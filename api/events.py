"""Canonical EDA event type constants shared across the pipeline."""
from enum import StrEnum


class EventType(StrEnum):
    # Pipeline lifecycle
    PIPELINE_STARTED   = "pipeline.started"
    PIPELINE_COMPLETED = "pipeline.completed"
    PIPELINE_FAILED    = "pipeline.failed"
    # Phase lifecycle
    PHASE_STARTED      = "phase.started"
    PHASE_COMPLETED    = "phase.completed"
    PHASE_FAILED       = "phase.failed"
    # Page generation
    PAGE_STARTED       = "page.started"
    PAGE_COMPLETED     = "page.completed"
    PAGE_FAILED        = "page.failed"
    # Agent (LLM) communication — request → chunk* → response
    AGENT_REQUEST      = "agent.request"
    AGENT_CHUNK        = "agent.chunk"
    AGENT_RESPONSE     = "agent.response"
    AGENT_ERROR        = "agent.error"
    AGENT_LOG          = "agent_log"        # generic progress log (no LLM, shown in UI)
    # Entity extraction (Phase 2.5)
    ENTITY_EXTRACTED   = "entity.extracted"    # data: {tables, procs, topics, endpoints, services, source}
    # MCP cross-check (Phase 3)
    MCP_QUERIED        = "mcp.queried"         # data: {provider, query_type, entity_count}
    MCP_RESPONDED      = "mcp.responded"       # data: {provider, context_bytes, tables_resolved}
    MCP_SKIPPED        = "mcp.skipped"         # data: {provider, reason}
    # Synthesis insight pages (Phase 4.5)
    SYNTHESIS_STARTED  = "synthesis.started"   # data: {page_id, title}
    SYNTHESIS_COMPLETED = "synthesis.completed" # data: {page_id, content_length, elapsed_ms}
    # Structure preview — awaiting user approval before page generation
    STRUCTURE_PREVIEW  = "structure.preview"  # data: {wiki_structure, page_count, section_count}
    # System
    HEARTBEAT          = "heartbeat"
    ERROR              = "error"
    COMPLETE           = "complete"


class PhaseType(StrEnum):
    SCAN       = "scan"
    STRUCTURE  = "structure"
    GENERATION = "generation"
    SAVE       = "save"
    RAG        = "rag"
    RETRIEVER  = "retriever"
    PROVIDER   = "provider"
    EXTRACT    = "extract"    # 코드 엔티티 추출
    MCP        = "mcp"        # MCP 크로스체크
    SYNTHESIS  = "synthesis"  # 종합 인사이트 생성
    INDEXING   = "indexing"   # Graphify/CodeGraph 사전 인덱싱
