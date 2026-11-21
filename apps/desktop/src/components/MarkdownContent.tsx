import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface MarkdownContentProps {
  content: string;
  compact?: boolean;
  className?: string;
}

function buildComponents(compact: boolean): Components {
  return {
    h1: ({ children }) => (
      <h1
        className={
          compact
            ? 'mb-1 text-xs font-bold text-slate-100'
            : 'mb-2 text-base font-bold text-slate-100'
        }
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={
          compact
            ? 'mb-1 text-xs font-semibold text-slate-200'
            : 'mb-1.5 text-sm font-semibold text-slate-100'
        }
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={
          compact
            ? 'mb-0.5 text-xs font-semibold text-slate-200'
            : 'mb-1 text-xs font-semibold uppercase tracking-wide text-slate-200'
        }
      >
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p className={compact ? 'mb-1 last:mb-0 leading-snug' : 'mb-2 last:mb-0 leading-relaxed'}>
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul className={compact ? 'mb-1 ml-3.5 list-disc space-y-0.5' : 'mb-2 ml-4 list-disc space-y-1'}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol
        className={
          compact ? 'mb-1 ml-3.5 list-decimal space-y-0.5' : 'mb-2 ml-4 list-decimal space-y-1'
        }
      >
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="leading-snug">{children}</li>,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="text-indigo-400 underline decoration-indigo-400/50 underline-offset-2 hover:text-indigo-300"
      >
        {children}
      </a>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-1.5 border-l-2 border-indigo-500/60 pl-2.5 italic text-slate-400">
        {children}
      </blockquote>
    ),
    code: ({ className, children }) => {
      const isBlock = Boolean(className?.includes('language-'));
      if (isBlock) {
        return <code className="font-mono text-[11px] text-slate-200">{children}</code>;
      }
      return (
        <code className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px] text-indigo-300">
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="my-1.5 overflow-x-auto rounded-md border border-slate-700/80 bg-slate-950 p-2 font-mono text-[11px] text-slate-200">
        {children}
      </pre>
    ),
    hr: () => <hr className="my-2 border-slate-700" />,
    table: ({ children }) => (
      <div className="my-1.5 overflow-x-auto">
        <table className="w-full border-collapse text-left text-[11px]">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-slate-700 bg-slate-800/80 px-2 py-1 font-semibold text-slate-200">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-slate-800 px-2 py-1 text-slate-300">{children}</td>
    ),
    input: ({ checked, type }) => {
      if (type === 'checkbox') {
        return (
          <input
            type="checkbox"
            checked={Boolean(checked)}
            readOnly
            className="mr-1.5 h-3 w-3 rounded border-slate-600 bg-slate-800 align-middle accent-indigo-500"
          />
        );
      }
      return null;
    },
    strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
    em: ({ children }) => <em className="italic text-slate-200">{children}</em>,
  };
}

/**
 * Renders card Markdown content with GitHub Flavored Markdown (GFM) support
 * and safe HTML escaping (raw HTML is never executed).
 */
export function MarkdownContent({
  content,
  compact = false,
  className = '',
}: MarkdownContentProps) {
  const components = buildComponents(compact);
  const baseText = compact ? 'text-[11px] text-slate-300' : 'text-xs text-slate-200';

  return (
    <div className={`break-words ${baseText} ${className}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
