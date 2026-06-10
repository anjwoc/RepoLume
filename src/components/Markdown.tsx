import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { FaGithub } from 'react-icons/fa';
import Mermaid from './Mermaid';
import { BlockActionWrapper, BlockActionType } from './BlockActionWrapper';
import { normalizeMarkdownContent } from '@/lib/markdown-normalize';
import 'katex/dist/katex.min.css';

export interface GitRoot {
  prefix: string;       // POSIX path of this repo relative to the project root ("" = root)
  name: string;         // repository directory name
  webUrl?: string | null; // browsable base URL derived from the git origin remote
  branch: string;       // default branch
}

interface MarkdownProps {
  content: string;
  onFixDiagram?: (chartCode: string, customPrompt?: string) => Promise<void>;
  onCodeChange?: (oldCode: string, newCode: string) => void;
  onBlockAction?: (type: BlockActionType, blockContent: string, startLine?: number, endLine?: number, prompt?: string) => Promise<void>;
  repositoryBaseUrl?: string;
  repoName?: string;
  gitRoots?: GitRoot[];
  hoverBgColor?: string;
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
}) => {
  const normalizedContent = normalizeMarkdownContent(content);

  // Build a GitHub link for a source file path. When git roots are known
  // (a bundling parent directory whose subprojects each have their own .git),
  // root the link at the matching individual repository using its origin
  // remote URL; otherwise fall back to repositoryBaseUrl + repoName.
  const buildSourceHref = (filePath: string): string => {
    const path = filePath.replace(/^\/+/, '');
    if (gitRoots && gitRoots.length > 0) {
      // Longest-prefix match: pick the most specific git root containing the file.
      const match = gitRoots
        .filter(r => r.webUrl && (r.prefix === '' || path === r.prefix || path.startsWith(r.prefix + '/')))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (match && match.webUrl) {
        const rel = match.prefix ? path.slice(match.prefix.length).replace(/^\/+/, '') : path;
        return `${match.webUrl.replace(/\/$/, '')}/blob/${match.branch}/${rel}`;
      }
    }
    const base = (repositoryBaseUrl || 'https://github.com').replace(/\/$/, '');
    return repoName ? `${base}/${repoName}/blob/main/${path}` : `${base}/blob/main/${path}`;
  };

  // Define markdown components
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MarkdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
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
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h1 className="text-xl font-bold mt-6 mb-3 dark:text-white" {...props}>{children}</h1>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h2({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      // Special styling for ReAct headings
      if (children && typeof children === 'string') {
        const text = children.toString();
        if (text.includes('Thought') || text.includes('Action') || text.includes('Observation') || text.includes('Answer')) {
          return (
            <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
              <h2
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
          <h2 className="text-lg font-bold mt-5 mb-3 dark:text-white" {...props}>{children}</h2>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h3({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h3 className="text-base font-semibold mt-4 mb-2 dark:text-white" {...props}>{children}</h3>
        </BlockActionWrapper>
      );
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h4({ children, node, ...props }: { children?: React.ReactNode; node?: any }) {
      const { raw, startLine, endLine } = extractRaw(normalizedContent, node);
      return (
        <BlockActionWrapper blockContent={raw} startLine={startLine} endLine={endLine} onBlockAction={onBlockAction} hoverBgColor={hoverBgColor}>
          <h4 className="text-sm font-semibold mt-3 mb-2 dark:text-white" {...props}>{children}</h4>
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
      return (
        <a
          href={href}
          className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      );
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
              <Mermaid
                chart={codeContent}
                className="w-full max-w-full"
                zoomingEnabled={false}
                onFixError={onFixDiagram ? (chart, prompt) => onFixDiagram(raw, prompt) : undefined}
                onCodeChange={onCodeChange}
              />
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
      const isFilePath = (text: string) => {
        if (!text) return false;
        const stripped = text.replace(/^Source:\s*/i, '');
        if (stripped.includes(' ')) return false;
        const fileExtRegex = /\.[a-zA-Z0-9]+$/;
        return stripped.includes('/') && fileExtRegex.test(stripped);
      };

      if (!isBlock && isFilePath(codeContent)) {
        const filePath = codeContent.replace(/^Source:\s*/i, '');
        const href = buildSourceHref(filePath);
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-gray-100/80 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700/80 text-gray-500 dark:text-gray-400 text-[11px] font-mono hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
            style={{ textDecoration: 'none', verticalAlign: 'middle' }}
            title={`${filePath} (Click to view)`}
          >
            <FaGithub size={10} className="opacity-60 flex-shrink-0" />
            <span className="truncate max-w-[160px]">
              {filePath}
            </span>
          </a>
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
  };

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

export default Markdown;
