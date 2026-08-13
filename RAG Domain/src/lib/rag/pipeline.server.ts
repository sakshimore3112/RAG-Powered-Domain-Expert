import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { chunkPages, type Page } from "./chunk";
import type { AskResult, Citation } from "./types";
import { embedTexts, embedQuery, chatComplete, EMBEDDING_MODEL, ANSWER_MODEL } from "./ai.server";


/**
 * Retrieval guardrails (hallucination control)
 * --------------------------------------------
 * TOP_K            how many chunks we pull from the vector index
 * SIMILARITY_FLOOR absolute cosine floor. Below this, a hit is noise — the
 *                  corpus simply does not discuss the question.
 * RELATIVE_WINDOW  keep only hits close to the best one, so a single strong
 *                  match is not diluted by five mediocre ones.
 *
 * If nothing survives the floor we never call the model at all: we return an
 * explicit "not in the corpus" refusal. That is cheaper, faster, and removes
 * the main opportunity for the model to invent an answer.
 */
export const TOP_K = 8;
export const SIMILARITY_FLOOR = 0.55;
export const RELATIVE_WINDOW = 0.12;
export const MAX_CONTEXT_CHUNKS = 6;

export type { AskResult, Citation };


const SYSTEM_PROMPT = `You are a domain expert that answers ONLY from the numbered source excerpts provided.

Rules, in priority order:
1. Every factual sentence must be supported by an excerpt and must end with its citation marker, e.g. [2]. Cite multiple markers when several excerpts support the same claim, e.g. [1][3].
2. Never use knowledge outside the excerpts. Never guess, extrapolate, or fill gaps with general knowledge.
3. If the excerpts only partly answer the question, answer the part you can and state plainly which part is not covered by the sources.
4. If the excerpts do not answer the question at all, reply with exactly: INSUFFICIENT_CONTEXT
5. Be concise and concrete. Prefer the document's own terminology. No preamble, no "based on the provided context".`;

export async function ingest(input: {
  filename: string;
  mimeType: string;
  pages: Page[];
}): Promise<{ documentId: string; chunkCount: number; wordCount: number; pageCount: number }> {
  const chunks = chunkPages(input.pages);
  if (chunks.length === 0) {
    throw new Error("No readable text found in this file.");
  }

  const wordCount = input.pages.reduce(
    (total, page) => total + (page.text.trim() ? page.text.trim().split(/\s+/).length : 0),
    0,
  );

  const { data: doc, error: docError } = await supabaseAdmin
    .from("documents")
    .insert({
      filename: input.filename,
      mime_type: input.mimeType,
      page_count: input.pages.length,
      word_count: wordCount,
      chunk_count: chunks.length,
      status: "embedding",
    })
    .select("id")
    .single();

  if (docError || !doc) throw new Error(docError?.message ?? "Could not save the document.");

  try {
    const vectors = await embedTexts(chunks.map((chunk) => chunk.content));

    const rows = chunks.map((chunk, index) => ({
      document_id: doc.id,
      chunk_index: chunk.chunkIndex,
      page_number: chunk.pageNumber,
      content: chunk.content,
      token_estimate: chunk.tokenEstimate,
      embedding: JSON.stringify(vectors[index]),
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabaseAdmin.from("chunks").insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }

    await supabaseAdmin.from("documents").update({ status: "ready" }).eq("id", doc.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Embedding failed.";
    await supabaseAdmin.from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    throw new Error(message);
  }

  return {
    documentId: doc.id,
    chunkCount: chunks.length,
    wordCount,
    pageCount: input.pages.length,
  };
}

export async function ask(question: string): Promise<AskResult> {
  const started = Date.now();
  const embedding = await embedQuery(question);

  const { data, error } = await supabaseAdmin.rpc("match_chunks", {
    query_embedding: JSON.stringify(embedding) as unknown as string,
    match_count: TOP_K,
  });

  if (error) throw new Error(error.message);

  const hits = (data ?? []) as {
    id: string;
    document_id: string;
    filename: string;
    chunk_index: number;
    page_number: number | null;
    content: string;
    similarity: number;
  }[];

  const topScore = hits.length > 0 ? hits[0]!.similarity : null;

  const kept = hits
    .filter(
      (hit) =>
        hit.similarity >= SIMILARITY_FLOOR &&
        topScore !== null &&
        hit.similarity >= topScore - RELATIVE_WINDOW,
    )
    .slice(0, MAX_CONTEXT_CHUNKS);

  const base = {
    topScore,
    retrievedCount: hits.length,
    model: ANSWER_MODEL,
    embeddingModel: EMBEDDING_MODEL,
  };

  if (kept.length === 0) {
    const result: AskResult = {
      ...base,
      answered: false,
      answer:
        "Nothing in the indexed documents is close enough to this question, so I won't answer it. Try rephrasing with the document's own vocabulary, or upload a source that covers this topic.",
      citations: [],
      latencyMs: Date.now() - started,
    };
    await log(question, result);
    return result;
  }

  const citations: Citation[] = kept.map((hit, index) => ({
    marker: index + 1,
    chunkId: hit.id,
    documentId: hit.document_id,
    filename: hit.filename,
    pageNumber: hit.page_number,
    chunkIndex: hit.chunk_index,
    similarity: hit.similarity,
    content: hit.content,
  }));

  const context = citations
    .map(
      (citation) =>
        `[${citation.marker}] ${citation.filename}${
          citation.pageNumber ? ` · page ${citation.pageNumber}` : ""
        }\n${citation.content}`,
    )
    .join("\n\n---\n\n");

  const raw = await chatComplete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Source excerpts:\n\n${context}\n\nQuestion: ${question}` },
  ]);

  const refused = raw.includes("INSUFFICIENT_CONTEXT") || raw.length === 0;

  const used = new Set(
    [...raw.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])).filter(Number.isFinite),
  );

  const result: AskResult = {
    ...base,
    answered: !refused,
    answer: refused
      ? "The retrieved passages were related but did not actually contain the answer, so I'm not going to guess. The closest excerpts are listed below."
      : raw,
    citations: refused ? citations : citations.filter((c) => used.size === 0 || used.has(c.marker)),
    latencyMs: Date.now() - started,
  };

  await log(question, result);
  return result;
}

async function log(question: string, result: AskResult) {
  await supabaseAdmin.from("queries").insert({
    question,
    answer: result.answer,
    answered: result.answered,
    top_score: result.topScore,
    retrieved_count: result.retrievedCount,
    latency_ms: result.latencyMs,
  });
}
