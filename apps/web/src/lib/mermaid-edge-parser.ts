import type { ParsedEdge } from './diagram-edge-types'

// Normalize a node ID: strip quotes, aliases, subgraph brackets
function normalizeId(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, '').replace(/\[.*?\]|\(.*?\)|\{.*?\}/g, '').trim()
}

// Build the lookup key used in DiagramEdgeData.edges
export function edgeKey(from: string, to: string, label: string): string {
  const base = `${from}→${to}`
  return label ? `${base}:${label}` : base
}

export function parseMermaidEdges(chart: string): ParsedEdge[] {
  const lines = chart.split('\n').map(l => l.trim())
  const firstLine = lines[0]?.toLowerCase() ?? ''

  if (firstLine.startsWith('sequencediagram')) {
    return parseSequenceEdges(lines)
  }
  return parseGraphEdges(lines)
}

// Sequence diagram: A->>B: label  /  A-->B: label  /  A->B: label  etc.
function parseSequenceEdges(lines: string[]): ParsedEdge[] {
  const edges: ParsedEdge[] = []
  // Captures: from, arrow type (ignored), to, optional label after ":"
  const re = /^([A-Za-z0-9_"'. -]+?)\s*(?:-[-x]?>>?|--x?>>?|<<[-x]?-[-x]?|--)\s*([A-Za-z0-9_"'. -]+?)\s*:?\s*(.*)$/
  let index = 0
  for (const line of lines) {
    const m = re.exec(line)
    if (!m) continue
    // Skip `Note` lines that happen to match
    if (/^note/i.test(line)) continue
    edges.push({
      from: normalizeId(m[1]),
      to: normalizeId(m[2]),
      label: m[3].trim(),
      index: index++,
    })
  }
  return edges
}

// graph LR/TD/flowchart: A --> B / A -->|label| B / A -- label --> B
function parseGraphEdges(lines: string[]): ParsedEdge[] {
  const edges: ParsedEdge[] = []
  // Pattern: NodeA [arrowhead] NodeB  with optional pipe-label or space-label
  const re = /^([A-Za-z0-9_"'\[\](){}. -]+?)\s*--[->x]?\|?([^|]*?)\|?\s*[-x>]{1,3}\s*([A-Za-z0-9_"'\[\](){}. -]+)/
  const simple = /^([A-Za-z0-9_"'\[\](){}. -]+?)\s*(?:-->|---|-\.-|===>?)\s*([A-Za-z0-9_"'\[\](){}. -]+)/
  let index = 0
  for (const line of lines) {
    if (/^(graph|flowchart|subgraph|end|classDef|class|style|click|\s*%%)/i.test(line)) continue

    const m = re.exec(line)
    if (m) {
      edges.push({
        from: normalizeId(m[1]),
        to: normalizeId(m[3]),
        label: m[2].trim(),
        index: index++,
      })
      continue
    }
    const s = simple.exec(line)
    if (s) {
      edges.push({
        from: normalizeId(s[1]),
        to: normalizeId(s[2]),
        label: '',
        index: index++,
      })
    }
  }
  return edges
}
