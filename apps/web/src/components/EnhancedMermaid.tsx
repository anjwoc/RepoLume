"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import mermaid from "mermaid";
import type { DiagramEdgeData, EdgeMetadata } from "@/lib/diagram-edge-types";
import { parseMermaidEdges } from "@/lib/mermaid-edge-parser";
import { enhanceSvg } from "@/lib/svg-enhancer";
import { sanitizeMermaidChart } from "./Mermaid";
import { EdgePopover } from "./EdgePopover";
import { EdgeInspector } from "./EdgeInspector";

interface EnhancedMermaidProps {
  chart: string;
  isDark?: boolean;
  edgeData?: DiagramEdgeData | null;
  className?: string;
}

interface HoverState {
  key: string;
  meta: EdgeMetadata;
  anchorRect: DOMRect;
}

export function EnhancedMermaid({ chart, isDark, edgeData, className = "" }: EnhancedMermaidProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`enhanced-mermaid-${Math.random().toString(36).slice(2, 9)}`);

  const [enrichedSvg, setEnrichedSvg] = useState("");
  const [edgeMap, setEdgeMap] = useState(new Map<string, EdgeMetadata>());
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [pinned, setPinned] = useState<{ key: string; meta: EdgeMetadata } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedEdges = useMemo(() => parseMermaidEdges(chart), [chart]);

  // Render Mermaid → enhance SVG
  useEffect(() => {
    if (!chart) return;
    let alive = true;

    const render = async () => {
      try {
        setError(null);
        mermaid.initialize({ suppressErrorRendering: true });
        const sanitized = sanitizeMermaidChart(chart);
        const { svg: rawSvg } = await mermaid.render(idRef.current, sanitized);
        if (!alive) return;

        let processedSvg = rawSvg;
        if (isDark) processedSvg = processedSvg.replace("<svg ", '<svg data-theme="dark" ');

        const { enrichedSvg: enhanced, edgeMap: map } = enhanceSvg(processedSvg, parsedEdges, edgeData ?? null);
        setEnrichedSvg(enhanced);
        setEdgeMap(map);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };

    render();
    return () => { alive = false; };
  }, [chart, isDark, parsedEdges, edgeData]);

  // Event delegation on the SVG container
  const handleMouseOver = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as Element).closest("[data-has-meta='true']") as HTMLElement | null;
    if (!target) { setHovered(null); return; }
    const key = target.dataset.edgeKey;
    if (!key) return;
    const meta = edgeMap.get(key);
    if (!meta) return;
    setHovered({ key, meta, anchorRect: target.getBoundingClientRect() });
  }, [edgeMap]);

  const handleMouseOut = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const related = e.relatedTarget as Element | null;
    if (related?.closest("[data-has-meta='true']")) return;
    setHovered(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as Element).closest("[data-has-meta='true']") as HTMLElement | null;
    if (!target) return;
    const key = target.dataset.edgeKey;
    if (!key) return;
    const meta = edgeMap.get(key);
    if (!meta) return;
    e.stopPropagation();
    setPinned(prev => prev?.key === key ? null : { key, meta });
    setHovered(null);
  }, [edgeMap]);

  if (error) {
    return (
      <div className={`text-red-500 text-xs p-2 ${className}`}>
        Diagram error: {error}
      </div>
    );
  }

  if (!enrichedSvg) {
    return <div className={`flex justify-center p-4 ${className}`}><div className="animate-pulse text-gray-400 text-xs">렌더링 중…</div></div>;
  }

  return (
    <div style={{ display: "flex", alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div
          ref={containerRef}
          className={className}
          dangerouslySetInnerHTML={{ __html: enrichedSvg }}
          onMouseOver={handleMouseOver}
          onMouseOut={handleMouseOut}
          onClick={handleClick}
          style={{ position: "relative" }}
        />

        {/* Hover popover */}
        {hovered && containerRef.current && (
          <EdgePopover
            meta={hovered.meta}
            anchorRect={hovered.anchorRect}
            containerRect={containerRef.current.getBoundingClientRect()}
          />
        )}
      </div>

      {/* Pinned inspector — slides in to the right */}
      {pinned && (
        <EdgeInspector
          edgeKey={pinned.key}
          meta={pinned.meta}
          onClose={() => setPinned(null)}
        />
      )}
    </div>
  );
}
