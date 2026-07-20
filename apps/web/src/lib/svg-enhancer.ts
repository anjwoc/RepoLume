import type { ParsedEdge, DiagramEdgeData, EdgeMetadata } from './diagram-edge-types'
import { edgeKey } from './mermaid-edge-parser'

export interface EnhancedEdge {
  key: string
  meta: EdgeMetadata
}

export interface SvgEnhanceResult {
  enrichedSvg: string
  // Maps data-edge-key attr values → metadata (only entries that have data)
  edgeMap: Map<string, EdgeMetadata>
}

// CSS injected once into the SVG so hit areas and cursors work
const ENHANCE_STYLE = `
<style>
  .edge-hit { pointer-events: stroke; fill: none; stroke-width: 18; stroke: transparent; cursor: default; }
  .edge-hit[data-has-meta="true"] { cursor: pointer; }
  .message-hit { pointer-events: all; fill: transparent; cursor: default; }
  .message-hit[data-has-meta="true"] { cursor: pointer; }
</style>
`

export function enhanceSvg(
  rawSvg: string,
  parsedEdges: ParsedEdge[],
  edgeData: DiagramEdgeData | null,
): SvgEnhanceResult {
  const edgeMap = new Map<string, EdgeMetadata>()
  if (!edgeData) return { enrichedSvg: rawSvg, edgeMap }

  // Build lookup by key variants (with label, without label, by index)
  const byKey = new Map<string, EdgeMetadata>()
  for (const [k, v] of Object.entries(edgeData.edges)) byKey.set(k, v)

  function resolveEdgeMeta(edge: ParsedEdge): { key: string; meta: EdgeMetadata } | null {
    const k1 = edgeKey(edge.from, edge.to, edge.label)
    if (byKey.has(k1)) return { key: k1, meta: byKey.get(k1)! }
    const k2 = edgeKey(edge.from, edge.to, '')
    if (byKey.has(k2)) return { key: k2, meta: byKey.get(k2)! }
    // index-based fallback
    const indexKey = `__index__${edge.index}`
    const indexedMeta = [...byKey.values()][edge.index]
    if (indexedMeta) return { key: indexKey, meta: indexedMeta }
    return null
  }

  const isSequence = /sequenceDiagram/i.test(rawSvg) || rawSvg.includes('messageLine')

  if (isSequence) {
    return enhanceSequence(rawSvg, parsedEdges, edgeMap, resolveEdgeMeta)
  }
  return enhanceGraph(rawSvg, parsedEdges, edgeMap, resolveEdgeMeta)
}

// ── Sequence diagram ────────────────────────────────────────────────────────

function enhanceSequence(
  svg: string,
  parsedEdges: ParsedEdge[],
  edgeMap: Map<string, EdgeMetadata>,
  resolve: (e: ParsedEdge) => { key: string; meta: EdgeMetadata } | null,
): SvgEnhanceResult {
  // messageLine0 = request arrow, messageLine1 = return/dashed arrow
  // They appear in the SVG in order, paired with each step (req first, resp second per step)
  // We match by index: parsedEdges[i] → messageLine pair i
  let edgeIdx = 0

  const enrichedSvg = svg.replace(
    /<(line|path)[^>]*class="(messageLine0|messageLine1)"[^>]*>/g,
    (match) => {
      // For request lines (messageLine0) we annotate; response lines get same key
      const isRequest = match.includes('messageLine0')
      if (!isRequest) return match // skip response lines for annotation

      const edge = parsedEdges[edgeIdx]
      edgeIdx++
      if (!edge) return match

      const resolved = resolve(edge)
      const key = resolved?.key ?? edgeKey(edge.from, edge.to, edge.label)
      const hasMeta = resolved !== null

      if (hasMeta && resolved) edgeMap.set(resolved.key, resolved.meta)

      // Extract the path/line d attribute or x1/y1/x2/y2 for hit area
      const hitAttr = hasMeta ? 'data-has-meta="true"' : ''
      const dataAttr = `data-edge-key="${key}" data-edge-idx="${edgeIdx - 1}"`

      // Inject data attrs on the original element + add a thick transparent hit overlay
      const annotated = match.replace(/<(line|path)/, `<$1 ${dataAttr}`)

      // Build a transparent hit-area rect (simpler than cloning path geometry)
      // We'll use a sibling rect spanning the SVG width to capture events on the row
      const hitLine = `<${match.includes('<line') ? 'line' : 'path'} ${dataAttr} ${hitAttr} class="message-hit" />`

      return annotated + hitLine
    },
  )

  // Inject styles before </svg>
  const withStyle = enrichedSvg.replace('</svg>', ENHANCE_STYLE + '</svg>')
  return { enrichedSvg: withStyle, edgeMap }
}

// ── Graph / Flowchart ────────────────────────────────────────────────────────

function enhanceGraph(
  svg: string,
  parsedEdges: ParsedEdge[],
  edgeMap: Map<string, EdgeMetadata>,
  resolve: (e: ParsedEdge) => { key: string; meta: EdgeMetadata } | null,
): SvgEnhanceResult {
  // Mermaid graph SVG: each edge is a <g class="edgePath"> containing a <path class="path">
  // We add data attributes to each <g class="edgePath"> in order, matching parsedEdges by index
  let idx = 0
  const enrichedSvg = svg.replace(
    /(<g[^>]*class="[^"]*edgePath[^"]*"[^>]*>)/g,
    (match) => {
      const edge = parsedEdges[idx]
      idx++
      if (!edge) return match

      const resolved = resolve(edge)
      const key = resolved?.key ?? edgeKey(edge.from, edge.to, edge.label)
      const hasMeta = resolved !== null

      if (hasMeta && resolved) edgeMap.set(resolved.key, resolved.meta)

      const dataAttrs = `data-edge-key="${key}" data-edge-idx="${idx - 1}" ${hasMeta ? 'data-has-meta="true"' : ''}`
      // Inject hit-area class + data attributes onto the <g> element
      const withData = match.replace(/class="([^"]*edgePath[^"]*)"/, `class="$1 edge-hit" ${dataAttrs}`)
      return withData
    },
  )

  const withStyle = enrichedSvg.replace('</svg>', ENHANCE_STYLE + '</svg>')
  return { enrichedSvg: withStyle, edgeMap }
}
