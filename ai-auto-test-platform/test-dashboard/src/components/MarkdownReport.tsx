import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  title?: string;
}

export default function MarkdownReport({ content, title = "測試報告" }: Props) {
  return (
    <div className="border-t border-slate-800 bg-slate-950/80">
      <div className="px-4 py-2 border-b border-slate-800/80 text-xs font-medium text-emerald-400">
        {title}
      </div>
      <div className="markdown-report max-h-[min(50vh,420px)] overflow-y-auto px-4 py-3 text-sm text-slate-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
