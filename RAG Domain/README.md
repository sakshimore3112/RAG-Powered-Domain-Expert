# Groundwork — RAG-Powered Domain Expert

Upload PDFs, DOCX, TXT or Markdown files, and ask questions in natural language.
Answers are generated **only** from your documents, with inline citations back to
the exact excerpt (and page number) that supports each claim. If the corpus does
not contain the answer, the system refuses instead of guessing.

---

## Why this exists

Most "chat with your docs" demos happily hallucinate. Groundwork is built around
the opposite goal: **grounding and refusal**. Every design decision — chunk size,
overlap, similarity thresholds, prompt rules, citation parsing — exists to make
unsupported answers hard to produce and easy to detect.

---

## Features

- **Client-side parsing** — PDF (pdf.js), DOCX (mammoth), TXT/MD/CSV/JSON parsed in
  the browser. No binary uploads hit the server; page numbers survive into citations.
- **Structure-aware chunking** — recursive split on paragraph → sentence → word
  boundaries, ~1,200 characters with 200 characters of overlap.
- **Vector search** — pgvector with an HNSW cosine index over 3,072-dimension
  embeddings, exposed as a `match_chunks` SQL function.
- **Hallucination control** — an absolute similarity floor plus a relative window
  around the top hit. If nothing survives, the LLM is never called and the user gets
  an explicit "not in the corpus" response.
- **Inline citations** — the model must attach `[n]` markers; the UI turns them into
  chips that scroll to the source excerpt, its filename, page and cosine score.
- **Observability** — every question is logged with the top score, retrieved count,
  latency and whether it was answered or refused.
- **Scanned PDF detection** — a PDF with no text layer is rejected with an explicit
  OCR message rather than being silently indexed as empty.

---

## Architecture

```text
Browser                          Server (TanStack server functions)        Postgres
───────                          ──────────────────────────────────        ────────
File  ──► extract-text.ts
          (pdf.js / mammoth)
             │ pages[]
             ▼
        ingestDocument()  ──────► chunkPages()  ──► embedTexts()  ──────►  documents
                                  (1200/200)       (batch of 50)           chunks
                                                                           (vector 3072,
                                                                            HNSW cosine)

Question ─► askQuestion()  ─────► embedQuery()
                                       │
                                       ▼
                                  match_chunks(query_embedding, k=8)  ◄───  chunks
                                       │
                                  floor 0.55 + window 0.12
                                       │
                            ┌──────────┴──────────┐
                       nothing kept          top ≤ 6 chunks
                            │                     │
                       refuse (no LLM)       LLM with strict
                                             citation prompt
                                                  │
                                             answer + [n] markers ────►  queries (log)
```

### Stack

| Layer      | Choice                                                     |
| ---------- | ---------------------------------------------------------- |
| Framework  | TanStack Start (React 19, Vite 7, SSR + server functions)   |
| Language   | TypeScript                                                  |
| Styling    | Tailwind CSS v4, shadcn/ui, OKLCH design tokens             |
| Database   | Postgres + pgvector (HNSW)                                  |
| Embeddings | `google/gemini-embedding-001` (3,072 dims)                  |
| Generation | `google/gemini-3.6-flash`, temperature 0.1                  |
| Parsing    | pdf.js, mammoth (both browser-side)                         |

---

## Retrieval parameters

| Parameter          | Value | Rationale                                                            |
| ------------------ | ----- | -------------------------------------------------------------------- |
| `CHUNK_TARGET`     | 1,200 chars (~300 tokens) | Small enough to stay topically coherent, large enough to hold a self-contained answer. |
| `CHUNK_OVERLAP`    | 200 chars (~15%)          | Stops facts that straddle a boundary from becoming unretrievable. Past ~20% it mostly buys duplicate hits. |
| `CHUNK_MIN`        | 120 chars                 | Crumbs are merged into the previous chunk instead of being embedded as noise. |
| `TOP_K`            | 8                         | Recall headroom before filtering. |
| `SIMILARITY_FLOOR` | 0.55                      | Absolute cosine floor — below it the corpus simply does not discuss the question. |
| `RELATIVE_WINDOW`  | 0.12                      | Keeps only hits close to the best one, so one strong match is not diluted by five mediocre ones. |
| `MAX_CONTEXT`      | 6 chunks (~1.8k tokens)   | Leaves ample room in the context window for the question and answer. |

---

## Data model

```sql
documents(id, filename, mime_type, page_count, word_count,
          chunk_count, status, error, created_at)

chunks(id, document_id → documents, chunk_index, page_number,
       content, token_estimate, embedding vector(3072))
       -- HNSW index, vector_cosine_ops

queries(id, question, answer, answered, top_score,
        retrieved_count, latency_ms, created_at)

match_chunks(query_embedding, match_count) → chunk rows + similarity
```

---

## Project layout

```text
src/
  lib/
    extract-text.ts              browser PDF/DOCX/text extraction
    rag.functions.ts             server functions: ingest, ask, list, delete
    rag/
      chunk.ts                   chunking strategy (pure, testable)
      ai.server.ts               embeddings + chat completion
      pipeline.server.ts         retrieval, thresholds, prompting, logging
      types.ts                   shared Citation / AskResult types
  components/rag/
    DocumentPanel.tsx            upload, corpus list, delete
    AnswerView.tsx               answer rendering + interactive citations
  routes/
    index.tsx                    main page
```

---

## Running locally

```sh
git clone <repository-url>
cd <repository-name>
npm install
npm run dev
```

Environment variables required: the Postgres/API URL and publishable key for the
backend, plus an API key for the model gateway used in `src/lib/rag/ai.server.ts`.

---

## Known limitations

- Scanned PDFs are rejected — no OCR pass.
- Single shared corpus, no authentication or per-user isolation.
- Dense retrieval only; no BM25 hybrid search or cross-encoder reranking yet.
- Ingestion is synchronous, so very large PDFs block the request.
