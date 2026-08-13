import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CornerDownLeft, Loader2, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DocumentPanel, type DocRow } from "@/components/rag/DocumentPanel";
import { AnswerView } from "@/components/rag/AnswerView";
import type { AskResult } from "@/lib/rag/types";
import {
  askQuestion,
  deleteDocument,
  ingestDocument,
  listDocuments,
} from "@/lib/rag.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Groundwork — RAG Domain Expert with Inline Citations" },
      {
        name: "description",
        content:
          "Upload PDFs and docs, then ask questions answered only from your sources — with inline citations, similarity scores, and an explicit refusal when retrieval comes up empty.",
      },
      { property: "og:title", content: "Groundwork — RAG Domain Expert with Inline Citations" },
      {
        property: "og:description",
        content:
          "Chunked, embedded, semantically searched. Grounded answers with citations, or an honest refusal.",
      },
    ],
  }),
  component: Home,
});

const SPEC = [
  { label: "Embeddings", value: "gemini-embedding-001 · 3072d" },
  { label: "Index", value: "pgvector HNSW · cosine" },
  { label: "Chunking", value: "1200 chars · 200 overlap" },
  { label: "Guardrail", value: "cosine floor 0.55" },
];

function Home() {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useServerFn(listDocuments);
  const ingest = useServerFn(ingestDocument);
  const remove = useServerFn(deleteDocument);
  const ask = useServerFn(askQuestion);

  const documentsQuery = useQuery({
    queryKey: ["documents"],
    queryFn: () => fetchDocuments({}),
  });

  const documents = (documentsQuery.data ?? []) as DocRow[];

  const ingestMutation = useMutation({
    mutationFn: (payload: {
      filename: string;
      mimeType: string;
      pages: { page: number; text: string }[];
    }) => ingest({ data: payload }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => remove({ data: { documentId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  const askMutation = useMutation({
    mutationFn: (value: string) => ask({ data: { question: value } }),
    onSuccess: (data) => {
      setResult(data as AskResult);
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const submit = () => {
    const value = question.trim();
    if (value.length < 3 || askMutation.isPending) return;
    setError(null);
    askMutation.mutate(value);
  };

  const hasCorpus = documents.length > 0;

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1400px] px-5 py-8 lg:px-10 lg:py-12">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label-mono mb-3 flex items-center gap-2">
            <Sparkles className="h-3 w-3 text-primary" />
            Retrieval-augmented domain expert
          </p>
          <h1 className="max-w-2xl text-4xl leading-[1.05] font-semibold sm:text-5xl">
            Answers that can{" "}
            <span className="text-primary">point at the paragraph</span> they came from.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Upload your documents. They're parsed in the browser, split on structural
            boundaries, embedded, and searched by meaning. Every claim carries a citation —
            and when retrieval finds nothing close enough, the model is never called.
          </p>
        </div>

        <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-3">
          {SPEC.map((item) => (
            <div key={item.label}>
              <dt className="label-mono">{item.label}</dt>
              <dd className="mt-1 font-mono text-xs text-foreground/80">{item.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-6rem)]">
          <DocumentPanel
            documents={documents}
            busy={ingestMutation.isPending}
            onIngest={async (payload) => {
              await ingestMutation.mutateAsync(payload);
            }}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        </div>

        <section className="panel flex min-h-[600px] flex-col overflow-hidden">
          <div className="border-b border-border p-5">
            <div className="relative">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                placeholder={
                  hasCorpus
                    ? "Ask something answerable from your documents…"
                    : "Upload a document first — questions are refused against an empty index."
                }
                className="resize-none border-border bg-input pr-4 text-[15px] focus-visible:ring-primary/40"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="label-mono">
                  Enter to ask · Shift+Enter for a new line
                </span>
                <Button
                  onClick={submit}
                  disabled={askMutation.isPending || question.trim().length < 3}
                  className="gap-2"
                >
                  {askMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CornerDownLeft className="h-4 w-4" />
                  )}
                  Ask
                </Button>
              </div>
            </div>
          </div>

          <div className="scroll-slim flex-1 overflow-y-auto p-6">
            {error && (
              <p className="mb-5 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            {askMutation.isPending && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Embedding question → searching {documents.reduce((sum, d) => sum + d.chunk_count, 0)}{" "}
                chunks → grounding answer…
              </div>
            )}

            {!askMutation.isPending && result && <AnswerView result={result} />}

            {!askMutation.isPending && !result && !error && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Search className="h-6 w-6 text-muted-foreground/50" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Ask a question to see the retrieved passages, their cosine similarity, and an
                  answer with inline citations you can click.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="mt-10 border-t border-border pt-6">
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-foreground/80">How grounding works:</strong> the
          question is embedded with the same model as the corpus, the HNSW index returns the 8
          nearest chunks, and anything below a 0.55 cosine floor — or more than 0.12 behind the
          best hit — is discarded. If nothing survives, the answer is a refusal rather than a
          generated guess. When passages do survive but don't actually contain the answer, the
          model returns an explicit insufficient-context signal and the raw excerpts are shown
          instead.
        </p>
      </footer>
    </main>
  );
}
