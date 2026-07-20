import React, { useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { FaGithub } from 'react-icons/fa';
import Mermaid from './Mermaid';
import { EnhancedMermaid } from './EnhancedMermaid';
import type { DiagramEdgeData } from '@/lib/diagram-edge-types';
import { BlockActionWrapper, BlockActionType } from './BlockActionWrapper';
import { normalizeMarkdownContent } from '@/lib/markdown-normalize';
import { slugifyHeading } from '@/lib/utils';
import 'katex/dist/katex.min.css';
import {
  isSourceFilePath,
  repairSourceUrl,
  resolveSourceLink,
  type GitRoot,
} from '@/lib/source-link-resolver';

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (React.isValidElement(node)) return extractText((node.props as any).children);
  return '';
}

interface MarkdownProps {
  content: string;
  onFixDiagram?: (chartCode: string, customPrompt?: string) => Promise<void>;
  onCodeChange?: (oldCode: string, newCode: string) => void;
  onBlockAction?: (type: BlockActionType, blockContent: string, startLine?: number, endLine?: number, prompt?: string) => Promise<void>;
  repositoryBaseUrl?: string;
  repoName?: string;
  gitRoots?: GitRoot[] | null;
  hoverBgColor?: string;
  onNavigateToPage?: (target: string) => void;
  /** Edge metadata for interactive diagrams. When provided, diagrams become hoverable/clickable. */
  diagramEdgeData?: DiagramEdgeData | null;
}

// Extract raw markdown text for a node using its position info
function extractRaw(rawContent: string, node: any): { raw: string, startLine?: number, endLine?: number } {
  if (!node?.position) return { raw: '' };
  const lines = rawContent.split('\n');
  const startLine = node.position.start.line - 1;
  const endLine = node.position.end.line - 1;
  return { raw: lines.slice(startLine, endLine + 1).join('\n'), startLine, endLine };
}

const Markdown: React.FC<MarkdownProps> = ({
  content,
  onFixDiagram,
  onCodeChange,
  onBlockAction,
  repositoryBaseUrl,
  repoName,
  gitRoots,
  hoverBgColor,
  onNavigateToPage,
  diagramEdgeData,
}) => {
  const normalizedContent = normalizeMarkdownContent(content);

  // Build a GitHub link for a path. `linkType` is 'blob' for files, 'tree' for directories/modules.
  // When git roots are known (a bundling parent directory whose subprojects each have their own .git),
  // root the link at the matching individual repository using its origin remote URL.
  const buildGithubHref = useCallback((rawPath: string, linkType: 'blob' | 'tree' = 'blob'): string => {
    // null = loading, [] = localPath missing/no git → both cases: defer, don't guess with repoName
    if (!gitRoots) return '';
    if (gitRoots.length > 0) {
      return resolveSourceLink(rawPath, gitRoots, linkType);
    }
    // gitRoots loaded and empty → localPath not configured; repoName fallback only if repositoryBaseUrl set
    const path = rawPath.replace(/^\.\//, '').replace(/^\/+/, '');
    if (!path) return '';
    const base = (repositoryBaseUrl || '').replace(/\/$/, '');
    if (!base || !repoName) return '';
    return `${base}/${repoName}/${linkType}/main/${path}`;
  }, [gitRoots, repositoryBaseUrl, repoName]);

  const buildSourceHref = useCallback((filePath: string): string => {
    if (!gitRoots) return '';
    if (gitRoots.length > 0) {
      return resolveSourceLink(filePath, gitRoots, 'blob');
    }
    const path = filePath.replace(/^\/+/, '');
    const base = (repositoryBaseUrl || 'https://github.com').replace(/\/$/, '');
    return repoName ? `${base}/${repoName}/blob/main/${path}` : `${base}/blob/main/${path}`;
  }, [gitRoots, repositoryBaseUrl, repoName]);

  // Define markdown components — memoized so scroll-triggered parent re-renders don't re-create
  // component objects and cause ReactMarkdown to re-render every block.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MarkdownComponents = useMemo<React.ComponentProps<typeof ReactMarkdown>['components']>(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <p className="mb-3 text-sm leading-relaxed dark:text-white" {...props}>{children}</p>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h1({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      const headingId = slugifyHeading(extractText(children)) || undefined;
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h1 id={headingId} className="text-xl font-bold mt-6 mb-3 dark:text-white" {...props}>{children}</h1>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h2({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      const headingId = slugifyHeading(extractText(children)) || undefined;
      // Special styling for ReAct headings
      if (children && typeof children === 'string') {
        const text = children.toString();
        if (text.includes('Thought') || text.includes('Action') || text.includes('Observation') || text.includes('Answer')) {
          return (
            <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
              <h2
                id={headingId}
                className={`text-base font-bold mt-5 mb-3 p-2 rounded ${
                  text.includes('Thought') ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300' :
                  text.includes('Action') ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                  text.includes('Observation') ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' :
                  text.includes('Answer') ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' :
                  'dark:text-white'
                }`}
                {...props}
              >
                {children}
              </h2>
            </BlockActionWrapper>
          );
        }
      }
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h2 id={headingId} className="text-lg font-bold mt-5 mb-3 dark:text-white" {...props}>{children}</h2>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h3({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      const headingId = slugifyHeading(extractText(children)) || undefined;
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h3 id={headingId} className="text-base font-semibold mt-4 mb-2 dark:text-white" {...props}>{children}</h3>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h4({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      const headingId = slugifyHeading(extractText(children)) || undefined;
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h4 id={headingId} className="text-sm font-semibold mt-3 mb-2 dark:text-white" {...props}>{children}</h4>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ul({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <ul className="list-disc pl-6 mb-4 text-sm dark:text-white space-y-2" {...props}>{children}</ul>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ol({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <ol className="list-decimal pl-6 mb-4 text-sm dark:text-white space-y-2" {...props}>{children}</ol>
        </BlockActionWrapper>
      );
    },
    li({ children, ...props }: { children?: React.ReactNode }) {
      return <li className="mb-2 text-sm leading-relaxed dark:text-white" {...props}>{children}</li>;
    },
    a({ children, href, ...props }: { children?: React.ReactNode; href?: string }) {
      // 1. Internal wiki navigation (relative wiki markdown only).
      // file:// links point at source files and are resolved through the detected .git root below.
      const isInternal = href && (
        href.endsWith('.md') && !href.startsWith('http') && !href.startsWith('file://')
      );
      if (isInternal && onNavigateToPage) {
        return (
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onNavigateToPage(href!); }}
            className="text-purple-600 dark:text-purple-400 hover:underline font-medium cursor-pointer"
            {...props}
          >
            {children}
          </a>
        );
      }

      // 2. Absolute URL → external tab
      if (href?.startsWith('http://') || href?.startsWith('https://')) {
        const repairedHref = repairSourceUrl(href, gitRoots);
        if (repairedHref === '') {
          return <span className="font-mono text-sm text-gray-700 dark:text-gray-300" {...props}>{children}</span>;
        }
        return (
          <a href={repairedHref ?? href} className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
            target="_blank" rel="noopener noreferrer" {...props}>
            {children}
          </a>
        );
      }

      // 3. Non-empty relative path (e.g. "affiliate-gateway" or "./src/Foo.java") → GitHub URL
      if (href) {
        if (href.startsWith('file://')) {
          const sourceUrl = buildGithubHref(href, 'blob');
          if (sourceUrl) {
            return <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline font-medium" {...props}>{children}</a>;
          }
        }
        const hasFileExt = /\.[a-zA-Z0-9]{1,6}$/.test(href);
        const ghUrl = buildGithubHref(href, hasFileExt ? 'blob' : 'tree');
        if (ghUrl) {
          return (
            <a href={ghUrl} target="_blank" rel="noopener noreferrer"
              className="text-purple-600 dark:text-purple-400 hover:underline font-medium" {...props}>
              {children}
            </a>
          );
        }
        // URL 해석 실패 — 레포 정보와 함께 Alert, GitHub에서 직접 검색 안내
        const repoInfo = gitRoots && gitRoots.length > 0
          ? gitRoots.map(r => r.webUrl || r.name).filter(Boolean).join('\n')
          : repoName || '(레포 정보 없음)';
        const alertMsg = `파일 경로를 GitHub에서 찾을 수 없습니다.\n\n경로: ${href}\n레포:\n${repoInfo}\n\nGitHub에서 직접 검색하거나 해당 레포에서 파일을 확인해 주세요.`;
        return (
          <span
            role="button"
            tabIndex={0}
            onClick={() => window.alert(alertMsg)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') window.alert(alertMsg); }}
            className="text-purple-400 dark:text-purple-500 underline decoration-dashed cursor-pointer opacity-70 hover:opacity-100 transition-opacity"
            title={`경로 해석 실패: ${href} — 클릭하여 레포 정보 확인`}
          >
            {children}
          </span>
        );
      }

      // 4. Empty href — children may already be a self-navigating element (e.g. file pill span).
      // Render children without an <a> wrapper to avoid opening same-page in a new tab.
      // If children is plain text matching a module name, try to build a GitHub tree link.
      const hasElementChild = React.Children.toArray(children).some(c => React.isValidElement(c));
      if (!hasElementChild) {
        const extractText = (node: React.ReactNode): string => {
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return node.map(extractText).join('');
          if (React.isValidElement(node) && (node.props as any).children)
            return extractText((node.props as any).children);
          return '';
        };
        const text = extractText(children).trim();
        if (text && !text.includes(' ')) {
          const hasFileExt = /\.[a-zA-Z0-9]{1,6}$/.test(text);
          const ghUrl = buildGithubHref(text, hasFileExt ? 'blob' : 'tree');
          if (ghUrl) {
            return (
              <a href={ghUrl} target="_blank" rel="noopener noreferrer"
                className="text-purple-600 dark:text-purple-400 hover:underline font-medium" {...props}>
                {children}
              </a>
            );
          }
        }
      }

      // No URL available — render children as-is (file pill or plain styled text)
      return <>{children}</>;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blockquote({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <blockquote
            className="border-l-4 border-gray-300 dark:border-gray-700 pl-4 py-1 text-gray-700 dark:text-gray-300 italic my-4 text-sm"
            {...props}
          >
            {children}
          </blockquote>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    table({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <div className="overflow-x-auto my-6 rounded-md">
            <table className="min-w-full text-sm border-collapse" {...props}>
              {children}
            </table>
          </div>
        </BlockActionWrapper>
      );
    },
    thead({ children, ...props }: { children?: React.ReactNode }) {
      return <thead className="bg-gray-100 dark:bg-gray-800" {...props}>{children}</thead>;
    },
    tbody({ children, ...props }: { children?: React.ReactNode }) {
      return <tbody className="divide-y divide-gray-200 dark:divide-gray-700" {...props}>{children}</tbody>;
    },
    tr({ children, ...props }: { children?: React.ReactNode }) {
      return <tr className="hover:bg-gray-50 dark:hover:bg-gray-900" {...props}>{children}</tr>;
    },
    th({ children, ...props }: { children?: React.ReactNode }) {
      return (
        <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300" {...props}>
          {children}
        </th>
      );
    },
    td({ children, ...props }: { children?: React.ReactNode }) {
      return <td className="px-4 py-3 border-t border-gray-200 dark:border-gray-700" {...props}>{children}</td>;
    },
    code(props: {
      inline?: boolean;
      className?: string;
      children?: React.ReactNode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    }) {
      const { inline, className, children, node, ...otherProps } = props;
      const match = /language-(\w+)/.exec(className || '');
      const codeContent = children ? String(children).replace(/\n$/, '') : '';
      const isBlock = inline === false
        || Boolean(match)
        || codeContent.includes('\n')
        || (node?.position?.start?.line !== undefined && node?.position?.start?.line !== node?.position?.end?.line);

      // Handle Mermaid diagrams
      if (isBlock && match && match[1] === 'mermaid') {
        const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
        return (
          <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
            <div className="my-8 bg-gray-50 dark:bg-gray-800 rounded-md overflow-hidden shadow-sm">
              {diagramEdgeData ? (
                <EnhancedMermaid
                  chart={codeContent}
                  className="w-full max-w-full"
                  edgeData={diagramEdgeData}
                />
              ) : (
                <Mermaid
                  chart={codeContent}
                  className="w-full max-w-full"
                  zoomingEnabled={false}
                  onFixError={onFixDiagram ? (chart, prompt) => onFixDiagram(raw, prompt) : undefined}
                  onCodeChange={onCodeChange}
                />
              )}
            </div>
          </BlockActionWrapper>
        );
      }

      // Handle code blocks
      if (isBlock) {
        const language = match?.[1] || 'text';
        const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
        return (
          <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
            <div className="my-6 rounded-md overflow-hidden text-sm shadow-sm">
              <div className="bg-gray-800 text-gray-200 px-5 py-2 text-sm flex justify-between items-center">
                <span>{language}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(codeContent); }}
                  className="text-gray-400 hover:text-white"
                  title="Copy code"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <SyntaxHighlighter
                language={language}
                style={tomorrow}
                className="!text-sm"
                customStyle={{ margin: 0, borderRadius: '0 0 0.375rem 0.375rem', padding: '1rem' }}
                showLineNumbers={true}
                wrapLines={true}
                wrapLongLines={true}
                {...otherProps}
              >
                {codeContent}
              </SyntaxHighlighter>
            </div>
          </BlockActionWrapper>
        );
      }

      // Handle inline code — file path pill or plain code
      if (!isBlock && isSourceFilePath(codeContent)) {
        const filePath = codeContent.replace(/^Source:\s*/i, '');
        const href = buildSourceHref(filePath);
        if (href) {
          return (
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); window.open(href, '_blank', 'noopener,noreferrer'); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.open(href, '_blank', 'noopener,noreferrer'); } }}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs font-mono font-medium hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors shadow-sm cursor-pointer"
              style={{ textDecoration: 'none', verticalAlign: 'middle', border: '1px solid rgba(128,128,128,0.2)' }}
              title={`View ${filePath} on GitHub`}
            >
              <span className="opacity-80" aria-hidden="true">
                <FaGithub size={12} />
              </span>
              {filePath}
            </span>
          );
        }
        // href unavailable (polyrepo — path missing service prefix): show as plain code pill
        return (
          <span
            className="inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-xs font-mono"
            style={{ verticalAlign: 'middle', border: '1px solid rgba(128,128,128,0.15)' }}
            title={filePath}
          >
            {filePath}
          </span>
        );
      }

      return (
        <code
          className={`${className || ''} font-mono bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-pink-500 dark:text-pink-400 text-sm`}
          {...otherProps}
        >
          {children}
        </code>
      );
    },
  }), [normalizedContent, onFixDiagram, onCodeChange, onBlockAction, hoverBgColor, onNavigateToPage, buildGithubHref, buildSourceHref, gitRoots, repoName]);

  return (
    // pl-10 gives space on the left for the grip handle
    <div className="prose prose-base dark:prose-invert max-w-none px-2 py-4 pl-10">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={MarkdownComponents}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default React.memo(Markdown);
