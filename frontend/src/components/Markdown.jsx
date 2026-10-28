import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Markdown with GitHub tables/strikethrough, wrapped in the shared style class. */
export default function Markdown({ children, className = '' }) {
  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ''}</ReactMarkdown>
    </div>
  );
}
