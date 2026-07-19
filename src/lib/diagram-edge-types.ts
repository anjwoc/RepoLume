export interface EdgeMetadata {
  protocol: 'http' | 'sql' | 'grpc' | 'event'
  method?: string
  path?: string
  query?: string
  sideEffect?: 'safe' | 'mutating'
  request?: { headers?: Record<string, string>; body?: unknown }
  response?: { status: number | string; latencyMs?: number; body?: unknown }
  extract?: Record<string, string>
}

// key format: "from→to:label" or "from→to" (no label)
export interface DiagramEdgeData {
  diagramId?: string
  edges: Record<string, EdgeMetadata>
}

export interface ParsedEdge {
  from: string
  to: string
  label: string
  index: number
}
