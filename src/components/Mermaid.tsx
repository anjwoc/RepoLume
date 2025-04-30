import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Initialize mermaid with defaults
mermaid.initialize({
  startOnLoad: true,
  theme: 'neutral',
  securityLevel: 'loose',
  themeCSS: `
    .node rect, .node circle, .node ellipse, .node polygon, .node path {
      fill: #f4f4f4;
      stroke: #999;
      stroke-width: 1px;
    }
    .edgePath .path {
      stroke: #666;
      stroke-width: 1.5px;
    }
    .edgeLabel {
      background-color: white;
      color: #333;
    }
    .label {
      color: #333;
    }
    .cluster rect {
      fill: #f4f4f4;
      stroke: #999;
      stroke-width: 1px;
    }
    
    /* Dark mode overrides - will be applied with data-theme="dark" */
    [data-theme="dark"] .node rect, 
    [data-theme="dark"] .node circle, 
    [data-theme="dark"] .node ellipse, 
    [data-theme="dark"] .node polygon, 
    [data-theme="dark"] .node path {
      fill: #2d3748;
      stroke: #4a5568;
    }
    [data-theme="dark"] .edgePath .path {
      stroke: #a0aec0;
    }
    [data-theme="dark"] .edgeLabel {
      background-color: #1a202c;
      color: #e2e8f0;
    }
    [data-theme="dark"] .label {
      color: #e2e8f0;
    }
    [data-theme="dark"] .cluster rect {
      fill: #2d3748;
      stroke: #4a5568;
    }
    [data-theme="dark"] .flowchart-link {
      stroke: #a0aec0;
    }
  `,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 12,
});

interface MermaidProps {
  chart: string;
  className?: string;
  onMermaidError?: (errorMessage: string, originalChart: string) => void;
}

// Full screen modal component for the diagram
const FullScreenModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ isOpen, onClose, children }) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  
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

  // Reset zoom when modal opens
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
      <div 
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-5xl max-h-[90vh] w-full overflow-hidden flex flex-col"
      >
        {/* Modal header with controls */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="font-medium text-gray-700 dark:text-gray-300">Diagram View</div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded"
                aria-label="Zoom out"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">{Math.round(zoom * 100)}%</span>
              <button 
                onClick={() => setZoom(Math.min(2, zoom + 0.1))}
                className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded"
                aria-label="Zoom in"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  <line x1="11" y1="8" x2="11" y2="14"></line>
                  <line x1="8" y1="11" x2="14" y2="11"></line>
                </svg>
              </button>
              <button 
                onClick={() => setZoom(1)}
                className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded"
                aria-label="Reset zoom"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                </svg>
              </button>
            </div>
            <button 
              onClick={onClose}
              className="text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-2 rounded"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        
        {/* Modal content with zoom */}
        <div className="overflow-auto p-4 flex-1 flex items-center justify-center">
          <div 
            style={{ 
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 0.2s ease-out'
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

const Mermaid: React.FC<MermaidProps> = ({ chart, className = '', onMermaidError }) => {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [retryAttempted, setRetryAttempted] = useState(false);
  const mermaidRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).substring(2, 9)}`);
  const isDarkModeRef = useRef(
    typeof window !== 'undefined' && 
    window.matchMedia && 
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (!chart) return;
    
    setRetryAttempted(false);
    
    let isMounted = true;
    
    const renderChart = async () => {
      if (!isMounted) return;
      
      try {
        setError(null);
        setSvg('');

        const processedChart = preprocessMermaidChart(chart);

        const { svg: renderedSvg } = await mermaid.render(idRef.current, processedChart);
        
        if (!isMounted) return;
        
        let processedSvg = renderedSvg;
        if (isDarkModeRef.current) {
          processedSvg = processedSvg.replace('<svg ', '<svg data-theme="dark" ');
        }
        
        setSvg(processedSvg);
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (isMounted && !retryAttempted && onMermaidError) {
          console.log('Attempting to auto-fix Mermaid diagram via API...');
          setRetryAttempted(true);
          onMermaidError(errorMessage, chart);
          return;
        }

        if (isMounted) {
          try {
            const fallbackChart = createEmergencyFallbackChart(chart);
            console.log('Attempting emergency fallback rendering with:', fallbackChart);
            
            const { svg: fallbackSvg } = await mermaid.render(`${idRef.current}-fallback`, fallbackChart);
            
            if (isMounted) {
              let processedSvg = fallbackSvg;
              if (isDarkModeRef.current) {
                processedSvg = processedSvg.replace('<svg ', '<svg data-theme="dark" ');
              }
              
              setSvg(processedSvg);
              setError('Diagram had syntax errors and was simplified for display');
            }
          } catch (fallbackErr) {
            console.error('Fallback rendering also failed:', fallbackErr);
            
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
        }
      }
    };

    renderChart();
    
    return () => {
      isMounted = false;
    };
  }, [chart, onMermaidError]);

  const handleDiagramClick = () => {
    if (!error && svg) {
      setIsFullscreen(true);
    }
  };

  if (error) {
    return (
      <div className={`border border-red-300 dark:border-red-800 rounded-md p-2 ${className}`}>
        <div className="text-red-500 dark:text-red-400 text-xs mb-1">Error rendering diagram</div>
        <div ref={mermaidRef} className="text-xs overflow-auto"></div>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={`flex justify-center items-center p-4 ${className}`}>
        <div className="animate-pulse text-gray-400 dark:text-gray-600 text-xs">Rendering diagram...</div>
      </div>
    );
  }

  return (
    <>
      <div className="relative group">
        <div 
          className={`flex justify-center overflow-auto text-center my-2 cursor-pointer hover:shadow-md transition-shadow duration-200 rounded-md ${className}`}
          dangerouslySetInnerHTML={{ __html: svg }}
          onClick={handleDiagramClick}
          title="Click to view fullscreen"
        />
        
        <div className="absolute top-2 right-2 bg-gray-700/70 dark:bg-gray-900/70 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1.5 text-xs shadow-md pointer-events-none">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="11" y1="8" x2="11" y2="14"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
          <span>Click to zoom</span>
        </div>
      </div>
      
      <FullScreenModal 
        isOpen={isFullscreen} 
        onClose={() => setIsFullscreen(false)}
      >
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </FullScreenModal>
    </>
  );
};

const preprocessMermaidChart = (chartText: string): string => {
    return chartText
      .replace(/\|([^|]+)\|>/g, '|"$1"|>')
      .replace(/>\|([^|]+)\|>/g, '>|"$1"|>')
      .replace(/>\|([^|]+)\|/g, '>|"$1"|')
      .replace(/-->\|([^|]+)\|/g, '-->|"$1"|')
      .replace(/-->\|([^|]+)\|>/g, '-->|"$1"|>');
  };

const createEmergencyFallbackChart = (originalChart: string): string => {
  const nodeRegex = /([A-Za-z0-9_]+)(?:\[["']?(.*?)["']?\])?/g;
  const nodes = new Set<string>();
  let match;
  
  while ((match = nodeRegex.exec(originalChart)) !== null) {
    if (match[1] && !match[1].match(/^(graph|flowchart|subgraph|end|style|classDef|class|click|linkStyle|direction)$/)) {
      nodes.add(match[1]);
    }
  }
  
  const nodesList = Array.from(nodes).slice(0, 10);
  if (nodesList.length === 0) {
    return 'graph TD\nA[Error: Could not extract nodes]';
  }
  
  let fallbackChart = 'graph TD\n';
  
  nodesList.forEach(node => {
    fallbackChart += `${node}[${node}]\n`;
  });
  
  for (let i = 0; i < nodesList.length - 1; i++) {
    fallbackChart += `${nodesList[i]}-->${nodesList[i + 1]}\n`;
  }
  
  return fallbackChart;
};

export default Mermaid; 