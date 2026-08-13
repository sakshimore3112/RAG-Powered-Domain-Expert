import { Fragment, useState } from "react";
import { ChevronDown, Quote, ShieldAlert } from "lucide-react";
import type { AskResult, Citation } from "@/lib/rag/types";

function InlineText({
  text,
  onCite,
}: {
  text: string;
  onCite: (marker: number) => void;
}) {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        const cite = part.match(/^\[(\d+)\]$/);
        if (cite) {
          const marker = Number(cite[1]);
          return (
            <button
              key={index}
              onClick={() => onCite(marker)}
              className="mx-0.5 inline-flex h-4 min-w-4 translate-y-[-2px] items-center justify-center rounded bg-primary/15 px-1 font-mono text-[10px] font-medium text-primary transition-colors hover:bg-primary/30"
            >
              {marker}
            </button>
          );
        }
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) {
          return (
            <strong key={index} className="font-semibold text-foreground">
              {bold[1]}
            </strong>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function AnswerBody({ text, onCite }: { text: string; onCite: (marker: number) => void }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const isList = lines.every((line) => /^\s*([-*•]|\d+\.)\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="space-y-1.5 pl-1">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span>
                    <InlineText text={line.replace(/^\s*([-*•]|\d+\.)\s+/, "")} onCite={onCite} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <InlineText text={block} onCite={onCite} />
          </p>
        );
      })}
    </div>
  );
}

function CitationCard({ citation, open }: { citation: Citation; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <li id={`citation-${citation.marker}`} className="rounded-lg bg-surface-raised">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 font-mono text-[11px] text-primary">
          {citation.marker}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{citation.filename}</span>
          <span className="block font-mono text-[11px] text-muted-foreground">
            {citation.pageNumber ? `page ${citation.pageNumber} · ` : ""}chunk #{citation.chunkIndex} ·
            cosine {citation.similarity.toFixed(3)}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <p className="border-t border-border px-3 py-3 text-[13px] leading-relaxed text-muted-foreground">
          {citation.content}
        </p>
      )}
    </li>
  );
}

export function AnswerView({ result }: { result: AskResult }) {
  const [focused, setFocused] = useState<number | null>(null);

  const scrollTo = (marker: number) => {
    setFocused(marker);
    document
      .getElementById(`citation-${marker}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span
          className={`label-mono ${result.answered ? "text-success" : "text-warning"}`}
          style={{ color: result.answered ? "var(--success)" : "var(--warning)" }}
        >
          {result.answered ? "Grounded answer" : "Refused — insufficient grounding"}
        </span>
        <span className="label-mono">
          top cosine {result.topScore === null ? "n/a" : result.topScore.toFixed(3)} ·{" "}
          {result.citations.length}/{result.retrievedCount} kept · {result.latencyMs}ms
        </span>
      </div>

      {result.answered ? (
        <AnswerBody text={result.answer} onCite={scrollTo} />
      ) : (
        <div className="flex gap-3 rounded-lg border border-border-strong bg-surface-raised px-4 py-3.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" style={{ color: "var(--warning)" }} />
          <p className="text-sm leading-relaxed text-muted-foreground">{result.answer}</p>
        </div>
      )}

      {result.citations.length > 0 && (
        <div>
          <p className="label-mono mb-2 flex items-center gap-1.5">
            <Quote className="h-3 w-3" /> Sources
          </p>
          <ul className="space-y-2">
            {result.citations.map((citation) => (
              <CitationCard
                key={citation.chunkId}
                citation={citation}
                open={focused === citation.marker}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
