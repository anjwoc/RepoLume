import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { RefreshCw, X, Edit3 } from 'lucide-react';
// We'll use dynamic import for svg-pan-zoom

// Initialize mermaid with defaults - Japanese aesthetic
mermaid.initialize({
  startOnLoad: true,
  theme: 'neutral',
  securityLevel: 'loose',
  suppressErrorRendering: true,
  logLevel: 'error',
  maxTextSize: 100000, // Increase text size limit
  fontFamily: 'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  htmlLabels: false,
  flowchart: {
    htmlLabels: false,
    curve: 'basis',
    nodeSpacing: 100,
    rankSpacing: 120,
    padding: 30,
    defaultRenderer: 'elk',
  },
  themeCSS: `
    /* Japanese aesthetic styles for all diagrams */
    .node rect, .node circle, .node ellipse, .node polygon, .node path {
      fill: #f8f4e6;
      stroke: #d7c4bb;
      stroke-width: 1px;
    }
    .edgePath .path {
      stroke: #9b7cb9;
      stroke-width: 1.5px;
    }
    .edgeLabel {
      background-color: transparent;
      color: #333333;
      p {
        background-color: transparent !important;
      }
    }
    .label, .nodeLabel, .edgeLabel {
      color: #333333;
      fill: #333333;
    }

    .cluster rect {
      fill: #f8f4e6;
      stroke: #d7c4bb;
      stroke-width: 1px;
    }

    /* Sequence diagram specific styles */
    .actor {
      fill: #f8f4e6;
      stroke: #d7c4bb;
      stroke-width: 1px;
    }
    text.actor {
      fill: #333333;
      stroke: none;
    }
    .messageText {
      fill: #333333;
      stroke: none;
    }
    .messageLine0, .messageLine1 {
      stroke: #9b7cb9;
    }
    .noteText {
      fill: #333333;
    }

    /* Dark mode overrides - will be applied with data-theme="dark" */
    [data-theme="dark"] .node rect,
    [data-theme="dark"] .node circle,
    [data-theme="dark"] .node ellipse,
    [data-theme="dark"] .node polygon,
    [data-theme="dark"] .node path {
      fill: #222222;
      stroke: #5d4037;
    }
    [data-theme="dark"] .edgePath .path {
      stroke: #9370db;
    }
    [data-theme="dark"] .edgeLabel {
      background-color: transparent;
      color: #f0f0f0;
    }
    [data-theme="dark"] .label, [data-theme="dark"] .nodeLabel, [data-theme="dark"] .edgeLabel {
      color: #f0f0f0;
      fill: #f0f0f0;
    }
    [data-theme="dark"] .cluster rect {
      fill: #222222;
      stroke: #5d4037;
    }
    [data-theme="dark"] .flowchart-link {
      stroke: #9370db;
    }

    /* Dark mode sequence diagram overrides */
    [data-theme="dark"] .actor {
      fill: #222222;
      stroke: #5d4037;
    }
    [data-theme="dark"] text.actor {
      fill: #f0f0f0;
      stroke: none;
    }
    [data-theme="dark"] .messageText {
      fill: #f0f0f0;
      stroke: none;
      font-weight: 500;
    }
    [data-theme="dark"] .messageLine0, [data-theme="dark"] .messageLine1 {
      stroke: #9370db;
      stroke-width: 1.5px;
    }
    [data-theme="dark"] .noteText {
      fill: #f0f0f0;
    }
    /* Additional styles for sequence diagram text */
    [data-theme="dark"] #sequenceNumber {
      fill: #f0f0f0;
    }
    [data-theme="dark"] text.sequenceText {
      fill: #f0f0f0;
      font-weight: 500;
    }
    [data-theme="dark"] text.loopText, [data-theme="dark"] text.loopText tspan {
      fill: #f0f0f0;
    }
    /* Add a subtle background to message text for better readability */
    [data-theme="dark"] .messageText, [data-theme="dark"] text.sequenceText {
      paint-order: stroke;
      stroke: #1a1a1a;
      stroke-width: 2px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* Force text elements to be properly colored */
    text[text-anchor][dominant-baseline],
    text[text-anchor][alignment-baseline],
    .nodeLabel,
    .edgeLabel,
    .label,
    text {
      fill: #777 !important;
    }

    [data-theme="dark"] text[text-anchor][dominant-baseline],
    [data-theme="dark"] text[text-anchor][alignment-baseline],
    [data-theme="dark"] .nodeLabel,
    [data-theme="dark"] .edgeLabel,
    [data-theme="dark"] .label,
    [data-theme="dark"] text {
      fill: #f0f0f0 !important;
    }

    /* Add clickable element styles with subtle transitions */
    .clickable {
      transition: all 0.3s ease;
    }
    .clickable:hover {
      transform: scale(1.03);
      cursor: pointer;
    }
    .clickable:hover > * {
      filter: brightness(0.95);
    }
  `,
  fontSize: 12,
});

// Sanitize Mermaid chart code before rendering/parsing.
// Mermaid parses `(` and `)` as special node-shape tokens, which breaks
// edge labels that contain parentheses, e.g. `-->|Commit Offset (with retry)|`.
// We strip parenthesised content from edge-label text to prevent parse errors.
// Exported so broken-diagram detection parses the SAME input the renderer uses,
// avoiding false positives where a diagram renders fine but raw parse fails.
export function sanitizeMermaidChart(input: string): string {
  // Strip ( ... ) from inside edge labels:  |some text (note)| → |some text|
  let sanitized = input.replace(
    /(\|[^|]*?)\([^)]*?\)([^|]*?\|)/g,
    '$1$2'
  );
  // Strip wrapping double-quotes inside pipe edge labels: |"Label"| → |Label|
  // Mermaid v11 treats |"..."| as a syntax error.
  sanitized = sanitized.replace(/\|"([^"]+)"\|/g, '|$1|');
  // Trim double spaces left by removal
  sanitized = sanitized.replace(/\|(\s{2,})/g, '| ');
  return sanitized;
}

interface MermaidProps {
  chart: string;
  className?: string;
  zoomingEnabled?: boolean;
  onFixError?: (chart: string, customPrompt?: string) => Promise<void>;
  onCodeChange?: (oldCode: string, newCode: string) => void;
}

// Full screen modal component for the diagram
const FullScreenModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onDownload?: () => void;
  svgContent: string;
}> = ({ isOpen, onClose, onDownload, svgContent }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Handle click outside to close
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen, onClose]);

  // Initialize pan-zoom functionality when modal opens and SVG is ready
  useEffect(() => {
    let panZoomInstance: any = null;

    if (isOpen && svgContent && containerRef.current) {
      const initializePanZoom = async () => {
        const svgElement = containerRef.current?.querySelector("svg");
        if (svgElement) {
          // Remove any max-width constraints to fit the modal
          svgElement.style.maxWidth = "none";
          svgElement.style.width = "100%";
          svgElement.style.height = "100%";

          try {
            // Dynamically import svg-pan-zoom only when needed
            const svgPanZoom = (await import("svg-pan-zoom")).default;

            panZoomInstance = svgPanZoom(svgElement, {
              zoomEnabled: true,
              controlIconsEnabled: true,
              fit: true,
              center: true,
              minZoom: 0.1,
              maxZoom: 20, // Allow very deep zoom
              zoomScaleSensitivity: 0.4,
            });
          } catch (error) {
            console.error("Failed to load svg-pan-zoom:", error);
          }
        }
      };

      // Wait for the SVG to be rendered in the DOM
      setTimeout(() => {
        void initializePanZoom();
      }, 100);
    }

    return () => {
      if (panZoomInstance) {
        try {
          panZoomInstance.destroy();
        } catch (e) {}
      }
    };
  }, [isOpen, svgContent]);

  if (!isOpen) return null;

  // Process the SVG string to ensure it takes full space initially
  const processedSvg = svgContent ? svgContent.replace(/<svg([^>]*)>/, '<svg$1 style="width: 100%; height: 100%; max-width: none;">') : '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div
        ref={modalRef}
        className="bg-card border border-border text-card-foreground rounded-xl shadow-2xl max-w-[96vw] max-h-[96vh] w-[96vw] h-[96vh] overflow-hidden flex flex-col"
      >
        {/* Modal header with controls */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold tracking-tight">다이어그램 뷰어</h2>
            <p className="text-xs text-muted-foreground">마우스 휠로 확대/축소, 빈 공간 드래그로 이동</p>
          </div>
          <div className="flex items-center gap-2">
            {/* SVG 다운로드 버튼 */}
            {onDownload && (
              <button
                onClick={onDownload}
                className="hover:bg-accent hover:text-accent-foreground p-2 rounded-md border border-border transition-colors bg-background shadow-sm"
                aria-label="SVG 다운로드"
                title="SVG 다운로드"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="hover:bg-destructive hover:text-destructive-foreground p-2 rounded-md border border-border transition-colors bg-background shadow-sm"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Modal content with SVG-pan-zoom container */}
        <div 
          ref={containerRef}
          className="p-0 flex-1 w-full h-full bg-white dark:bg-gray-100 rounded-b-xl overflow-hidden"
          dangerouslySetInnerHTML={{ __html: processedSvg }}
        />
      </div>
    </div>
  );
};

const Mermaid: React.FC<MermaidProps> = ({ chart: initialChart, className = '', zoomingEnabled = false, onFixError, onCodeChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mermaidRef = useRef<HTMLDivElement>(null);
  
  const [chart, setChart] = useState(initialChart);
  const [isEditingCode, setIsEditingCode] = useState(false);
  const [editCode, setEditCode] = useState(initialChart);
  
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  
  // Sync if prop changes externally
  useEffect(() => {
    setChart(initialChart);
    setEditCode(initialChart);
  }, [initialChart]);

  const handleApplyEdit = () => {
    setChart(editCode);
    if (onCodeChange) {
      onCodeChange(initialChart, editCode);
    }
  };

  const handleCustomFix = async (promptText: string) => {
    if (!onFixError) return;
    try {
      setIsFixing(true);
      setShowPromptModal(false);
      await onFixError(chart, promptText);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFixing(false);
    }
  };

  const idRef = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`);
  const isDarkModeRef = useRef(
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // Initialize pan-zoom functionality when SVG is rendered
  useEffect(() => {
    if (svg && zoomingEnabled && containerRef.current) {
      const initializePanZoom = async () => {
        const svgElement = containerRef.current?.querySelector("svg");
        if (svgElement) {
          // Remove any max-width constraints
          svgElement.style.maxWidth = "none";
          svgElement.style.width = "100%";
          svgElement.style.height = "100%";

          try {
            // Dynamically import svg-pan-zoom only when needed in the browser
            const svgPanZoom = (await import("svg-pan-zoom")).default;

            svgPanZoom(svgElement, {
              zoomEnabled: true,
              controlIconsEnabled: true,
              fit: true,
              center: true,
              minZoom: 0.1,
              maxZoom: 10,
              zoomScaleSensitivity: 0.3,
            });
          } catch (error) {
            console.error("Failed to load svg-pan-zoom:", error);
          }
        }
      };

      // Wait for the SVG to be rendered
      setTimeout(() => {
        void initializePanZoom();
      }, 100);
    }
  }, [svg, zoomingEnabled]);


  useEffect(() => {
    if (!chart) return;

    let isMounted = true;

    const renderChart = async () => {
      if (!isMounted) return;

      try {
        setError(null);
        setSvg('');

        // detectBrokenDiagrams / wiki-generator re-call mermaid.initialize() which resets
        // suppressErrorRendering. Re-assert it before each render so we always get a throw
        // instead of the bomb SVG, and our catch block can display the error properly.
        mermaid.initialize({ suppressErrorRendering: true });
        const sanitizedChart = sanitizeMermaidChart(chart);
        const { svg: renderedSvg } = await mermaid.render(idRef.current, sanitizedChart);

        if (!isMounted) return;

        let processedSvg = renderedSvg;
        if (isDarkModeRef.current) {
          processedSvg = processedSvg.replace('<svg ', '<svg data-theme="dark" ');
        }

        setSvg(processedSvg);

        // Call mermaid.contentLoaded to ensure proper initialization
        setTimeout(() => {
          mermaid.contentLoaded();
        }, 50);
      } catch (err) {
        console.error('Mermaid rendering error:', err);

        const errorMessage = err instanceof Error ? err.message : String(err);

        if (isMounted) {
          setError(`Failed to render diagram: ${errorMessage}`);

          if (mermaidRef.current) {
            mermaidRef.current.innerHTML = `
              <div class="text-red-500 dark:text-red-400 text-xs mb-1">Syntax error in diagram</div>
              <pre class="text-xs overflow-auto p-2 bg-gray-100 dark:bg-gray-800 rounded">${chart}</pre>
            `;
          }
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  const handleDiagramClick = () => {
    if (!error && svg) {
      setIsFullscreen(true);
    }
  };

  const handleDownloadSvg = () => {
    if (!fullSizeSvg) return;
    const blob = new Blob([fullSizeSvg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFixDiagram = async () => {
    if (!onFixError) return;
    try {
      setIsFixing(true);
      await onFixError(chart);
    } catch (e) {
      console.error(e);
    } finally {
      setIsFixing(false);
    }
  };

  if (error) {
    return (
      <div className={`border border-[var(--highlight)]/30 rounded-md p-4 bg-[var(--highlight)]/5 ${className}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[var(--highlight)] text-xs font-medium flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            다이어그램 렌더링 에러
          </div>
          {onFixError && (
            <button
              onClick={handleFixDiagram}
              disabled={isFixing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--divider)] rounded-md text-[var(--text-secondary)] hover:text-[var(--text)] text-xs transition-colors cursor-pointer"
            >
              <RefreshCw size={12} className={isFixing ? "animate-spin" : ""} />
              {isFixing ? "복구 중..." : "다이어그램 고치기"}
            </button>
          )}
        </div>
        <div ref={mermaidRef} className="text-xs overflow-auto"></div>
        <div className="mt-3 text-xs text-[var(--muted)] font-serif">
          다이어그램 구문에 오류가 있어 렌더링할 수 없습니다.
        </div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={`flex justify-center items-center p-4 ${className}`}>
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-[var(--accent-primary)]/70 rounded-full animate-pulse"></div>
          <div className="w-2 h-2 bg-[var(--accent-primary)]/70 rounded-full animate-pulse delay-75"></div>
          <div className="w-2 h-2 bg-[var(--accent-primary)]/70 rounded-full animate-pulse delay-150"></div>
          <span className="text-[var(--muted)] text-xs ml-2 font-serif">다이어그램 렌더링 중...</span>
        </div>
      </div>
    );
  }

  // SVG 문자열에 강제로 width, height를 100%로 주입하여 모달 크기에 맞춰 꽉 차게 렌더링되도록 수정
  const fullSizeSvg = zoomingEnabled 
    ? svg.replace(/<svg([^>]*)>/, '<svg$1 style="width: 100%; height: 100%; max-width: none;">')
    : svg;

  return (
    <>
      <div
        ref={containerRef}
        className={`w-full max-w-full ${zoomingEnabled ? "h-[600px] p-4" : ""}`}
      >
        <div
          className={`relative group ${zoomingEnabled ? "h-full rounded-lg border-2 border-black" : ""}`}
        >
          <div
            className={`flex justify-center overflow-auto text-center my-2 cursor-pointer hover:shadow-md transition-shadow duration-200 rounded-md ${className} ${zoomingEnabled ? "h-full w-full" : ""}`}
            dangerouslySetInnerHTML={{ __html: fullSizeSvg }}
            onClick={zoomingEnabled ? undefined : handleDiagramClick}
            title={zoomingEnabled ? undefined : "Click to view fullscreen"}
          />

          {!zoomingEnabled && onFixError && (
            <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-start gap-2 z-10">
              <button
                onClick={(e) => { e.stopPropagation(); setShowPromptModal(true); }}
                className="bg-purple-600/90 hover:bg-purple-600 text-white p-1.5 rounded-md flex items-center gap-1.5 text-xs shadow-md transition-colors"
                disabled={isFixing}
              >
                <RefreshCw size={12} className={isFixing ? "animate-spin" : ""} />
                {isFixing ? "수정 중..." : "다이어그램 수정"}
              </button>
            </div>
          )}
          {showPromptModal && (
            <div className="absolute top-10 left-2 w-80 bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 z-20 text-left" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1"><Edit3 size={12}/> 다이어그램 변경 요청</h4>
                <button onClick={() => setShowPromptModal(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <X size={14} />
                </button>
              </div>
              <textarea 
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                placeholder="어떻게 변경할까요? (예: LR 방향으로 바꿔줘)"
                className="w-full h-20 p-2 text-xs border rounded-md dark:bg-[#2d2d2d] dark:border-gray-600 dark:text-gray-200 mb-2 resize-none"
              />
              <div className="flex flex-wrap gap-1 mb-2">
                <button onClick={() => handleCustomFix("다이어그램의 모든 내용을 한국어로 번역해줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">🇰🇷 한국어로 번역</button>
                <button onClick={() => handleCustomFix("다이어그램의 방향을 왼쪽에서 오른쪽(LR)으로 변경해줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">➡️ 가로(LR) 방향</button>
                <button onClick={() => handleCustomFix("이 다이어그램을 더 상세하고 구체적으로 확장해서 그려줘")} className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-[10px] rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300">🔍 더 상세하게</button>
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={() => handleCustomFix(customPrompt)}
                  disabled={!customPrompt.trim()}
                  className="px-3 py-1.5 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  수정 요청
                </button>
              </div>
            </div>
          )}

          {/* Manual Edit Modal */}
          {isEditingCode && (
            <div className="absolute top-0 left-0 w-full h-full bg-white dark:bg-[#1e1e1e] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-3 z-30 flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1"><Edit3 size={12}/> 실시간 코드 편집</h4>
                <button onClick={() => setIsEditingCode(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  <X size={14} />
                </button>
              </div>
              <textarea 
                value={editCode}
                onChange={e => setEditCode(e.target.value)}
                className="w-full flex-1 p-2 text-xs font-mono border rounded-md dark:bg-[#2d2d2d] dark:border-gray-600 dark:text-gray-200 mb-2 resize-none"
              />
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => setIsEditingCode(false)}
                  className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  취소
                </button>
                <button 
                  onClick={handleApplyEdit}
                  className="px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                >
                  적용 (미리보기)
                </button>
              </div>
            </div>
          )}
          {!zoomingEnabled && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <button 
                onClick={(e) => { e.stopPropagation(); setIsEditingCode(true); setEditCode(chart); }}
                className="bg-gray-700/80 hover:bg-gray-800 text-white p-1.5 rounded-md flex items-center gap-1.5 text-xs shadow-md transition-colors cursor-pointer"
              >
                <Edit3 size={12} />
                <span>코드 수정</span>
              </button>
              <div className="bg-gray-700/70 dark:bg-gray-900/70 text-white p-1.5 rounded-md flex items-center gap-1.5 text-xs shadow-md pointer-events-none">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
                <span>Click to zoom</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {!zoomingEnabled && (
        <FullScreenModal
          isOpen={isFullscreen}
          onClose={() => setIsFullscreen(false)}
          onDownload={handleDownloadSvg}
          svgContent={svg}
        />
      )}
    </>
  );
};



export default Mermaid;
