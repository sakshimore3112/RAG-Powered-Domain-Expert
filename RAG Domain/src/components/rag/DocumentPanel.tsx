import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Loader2, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { extractText } from "@/lib/extract-text";
import { chunkPages } from "@/lib/rag/chunk";

export type DocRow = {
  id: string;
  filename: string;
  page_count: number;
  word_count: number;
  chunk_count: number;
  status: string;
  created_at: string;
};

type Props = {
  documents: DocRow[];
  busy: boolean;
  onIngest: (payload: {
    filename: string;
    mimeType: string;
    pages: { page: number; text: string }[];
  }) => Promise<void>;
  onDelete: (id: string) => void;
};

export function DocumentPanel({ documents, busy, onIngest, onDelete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setError(null);
      for (const file of Array.from(files)) {
        try {
          setStage(`Parsing ${file.name}`);
          const { pages, mimeType } = await extractText(file);
          const preview = chunkPages(pages);
          setStage(`Embedding ${preview.length} chunks from ${file.name}`);
          await onIngest({ filename: file.name, mimeType, pages });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not process that file.");
        }
      }
      setStage(null);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onIngest],
  );

  const totalChunks = documents.reduce((sum, doc) => sum + doc.chunk_count, 0);

  return (
    <section className="panel flex h-full flex-col overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-sm font-semibold">Corpus</h2>
        <span className="label-mono">
          {documents.length} docs · {totalChunks} chunks
        </span>
      </header>

      <div className="p-4">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void handleFiles(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border-strong hover:border-primary/60"
          }`}
        >
          {busy || stage ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="font-mono text-xs text-muted-foreground">{stage ?? "Indexing…"}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              <p className="text-sm font-medium">Drop PDFs, DOCX, TXT or MD</p>
              <p className="text-xs text-muted-foreground">
                Parsed in-browser · chunked · embedded
              </p>
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,text/*"
            className="hidden"
            onChange={(event) => void handleFiles(event.target.files)}
          />
        </div>

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}
      </div>

      <div className="scroll-slim flex-1 overflow-y-auto px-4 pb-4">
        {documents.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            The index is empty. Every answer is refused until something is uploaded.
          </p>
        ) : (
          <ul className="space-y-2">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="group flex items-start gap-3 rounded-lg bg-surface-raised px-3 py-2.5"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.filename}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    {doc.chunk_count} chunks
                    {doc.page_count > 1 ? ` · ${doc.page_count}p` : ""} ·{" "}
                    {doc.word_count.toLocaleString()} words
                    {doc.status !== "ready" ? ` · ${doc.status}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(doc.id)}
                  aria-label={`Remove ${doc.filename}`}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-xs text-muted-foreground"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          Add more sources
        </Button>
      </footer>
    </section>
  );
}
