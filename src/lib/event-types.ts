/**
 * Canonical EDA event type constants shared across the pipeline.
 * Python equivalent: api/events.py EventType
 */
export const EventType = {
  // Pipeline lifecycle
  PIPELINE_STARTED:   'pipeline.started',
  PIPELINE_COMPLETED: 'pipeline.completed',
  PIPELINE_FAILED:    'pipeline.failed',
  // Phase lifecycle
  PHASE_STARTED:      'phase.started',
  PHASE_COMPLETED:    'phase.completed',
  PHASE_FAILED:       'phase.failed',
  // Page generation
  PAGE_STARTED:       'page.started',
  PAGE_COMPLETED:     'page.completed',
  PAGE_FAILED:        'page.failed',
  // Agent (LLM) communication — request → chunk* → response
  AGENT_REQUEST:      'agent.request',
  AGENT_CHUNK:        'agent.chunk',
  AGENT_RESPONSE:     'agent.response',
  AGENT_ERROR:        'agent.error',
  // Structure preview — frontend shows ToC for user approval before page generation
  STRUCTURE_PREVIEW:  'structure.preview',
  // Entity extraction (Phase 2.5)
  ENTITY_EXTRACTED:   'entity.extracted',
  // MCP cross-check (Phase 3)
  MCP_QUERIED:        'mcp.queried',
  MCP_RESPONDED:      'mcp.responded',
  MCP_SKIPPED:        'mcp.skipped',
  // System
  HEARTBEAT:          'heartbeat',
  ERROR:              'error',
  COMPLETE:           'complete',
} as const

export type EventType = typeof EventType[keyof typeof EventType]

export const PhaseType = {
  SCAN:       'scan',
  STRUCTURE:  'structure',
  EXTRACT:    'extract',
  MCP:        'mcp',
  GENERATION: 'generation',
  SYNTHESIS:  'synthesis',
  SAVE:       'save',
  RAG:        'rag',
  RETRIEVER:  'retriever',
  PROVIDER:   'provider',
} as const

export type PhaseType = typeof PhaseType[keyof typeof PhaseType]

export interface PipelineEvent {
  id: number
  type: EventType | string
  stream_id: string
  ts: string
  phase?: PhaseType | string
  message: string
  data: Record<string, unknown>
}
