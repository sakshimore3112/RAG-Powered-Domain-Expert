/**
 * Chunking strategy
 * -----------------
 * Recursive, structure-aware splitting with a fixed overlap.
 *
 * Why ~1,200 characters (~300 tokens)?
 *  - Small enough that a single chunk is topically coherent, so its embedding
 *    is not an average of several unrelated ideas (the classic cause of fuzzy
 *    retrieval on long chunks).
 *  - Large enough to carry a self-contained answer, so the model rarely needs
 *    three neighbouring chunks stitched together to be correct.
 *  - 6 retrieved chunks x ~300 tokens = ~1.8k tokens of context: plenty of
 *    headroom in the model window for the question and a grounded answer.
 *
 * Why 200 characters of overlap (~15%)?
 *  - A fact that straddles a boundary would otherwise be split in half and be
 *    unretrievable from either side. Overlap is cheap insurance; beyond ~20%
 *    it mostly buys duplicate hits in the result list.
 *
 * Boundaries are preferred in this order: paragraph > sentence > word, so a
 * chunk almost never begins mid-sentence.
 */
export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 200;
export const CHUNK_MIN_CHARS = 120;

export type Page = { page: number; text: string };

export type BuiltChunk = {
  chunkIndex: number;
  pageNumber: number | null;
  content: string;
  tokenEstimate: number;
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split a block into the largest units that still fit under the target. */
function splitBlock(block: string): string[] {
  if (block.length <= CHUNK_TARGET_CHARS) return [block];

  const sentences = block.match(/[^.!?\n]+[.!?]+["')\]]*|\S[^.!?\n]*/g) ?? [block];
  const out: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (sentence.length > CHUNK_TARGET_CHARS) {
      if (buffer) {
        out.push(buffer.trim());
        buffer = "";
      }
      // Hard-wrap runaway sentences (tables, code, OCR noise) on word bounds.
      const words = sentence.split(/\s+/);
      let line = "";
      for (const word of words) {
        if ((line + " " + word).length > CHUNK_TARGET_CHARS) {
          out.push(line.trim());
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line.trim()) out.push(line.trim());
      continue;
    }

    if ((buffer + " " + sentence).length > CHUNK_TARGET_CHARS) {
      out.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = buffer ? `${buffer} ${sentence}` : sentence;
    }
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out.filter(Boolean);
}

function tailOverlap(text: string): string {
  if (text.length <= CHUNK_OVERLAP_CHARS) return text;
  const tail = text.slice(-CHUNK_OVERLAP_CHARS);
  const boundary = tail.search(/[.!?]\s|\n/);
  return boundary === -1 ? tail : tail.slice(boundary + 1).trim();
}

export function chunkPages(pages: Page[]): BuiltChunk[] {
  const chunks: BuiltChunk[] = [];
  let carry = "";
  let carryPage: number | null = null;

  const push = (content: string, page: number | null) => {
    const trimmed = content.trim();
    if (trimmed.length < CHUNK_MIN_CHARS && chunks.length > 0) {
      // Merge crumbs into the previous chunk rather than embedding noise.
      const prev = chunks[chunks.length - 1]!;
      prev.content = `${prev.content}\n${trimmed}`.trim();
      prev.tokenEstimate = estimateTokens(prev.content);
      return;
    }
    if (!trimmed) return;
    chunks.push({
      chunkIndex: chunks.length,
      pageNumber: page,
      content: trimmed,
      tokenEstimate: estimateTokens(trimmed),
    });
  };

  for (const { page, text } of pages) {
    const clean = normalize(text);
    if (!clean) continue;

    const paragraphs = clean.split(/\n{2,}/).flatMap(splitBlock);
    let buffer = carry;
    if (carryPage === null) carryPage = page;

    for (const paragraph of paragraphs) {
      const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (candidate.length > CHUNK_TARGET_CHARS && buffer) {
        push(buffer, carryPage ?? page);
        buffer = `${tailOverlap(buffer)}\n\n${paragraph}`.trim();
        carryPage = page;
      } else {
        buffer = candidate;
      }
    }

    carry = buffer;
  }

  if (carry.trim()) push(carry, carryPage);
  return chunks;
}
