export type Citation = {
  marker: number;
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number | null;
  chunkIndex: number;
  similarity: number;
  content: string;
};

export type AskResult = {
  answered: boolean;
  answer: string;
  citations: Citation[];
  topScore: number | null;
  retrievedCount: number;
  latencyMs: number;
  model: string;
  embeddingModel: string;
};
