CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'text/plain',
  page_count integer NOT NULL DEFAULT 0,
  word_count integer NOT NULL DEFAULT 0,
  chunk_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  page_number integer,
  content text NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  embedding vector(3072) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text,
  answered boolean NOT NULL DEFAULT false,
  top_score real,
  retrieved_count integer NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chunks_document_id_idx ON public.chunks(document_id);
CREATE INDEX chunks_embedding_idx ON public.chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO anon, authenticated;
GRANT ALL ON public.documents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chunks TO anon, authenticated;
GRANT ALL ON public.chunks TO service_role;
GRANT SELECT, INSERT ON public.queries TO anon, authenticated;
GRANT ALL ON public.queries TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents are public" ON public.documents FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "chunks are public" ON public.chunks FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "queries readable" ON public.queries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "queries insertable" ON public.queries FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector(3072),
  match_count integer DEFAULT 6
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  filename text,
  chunk_index integer,
  page_number integer,
  content text,
  similarity real
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    d.filename,
    c.chunk_index,
    c.page_number,
    c.content,
    (1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)))::real AS similarity
  FROM public.chunks c
  JOIN public.documents d ON d.id = c.document_id
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_chunks(vector, integer) TO anon, authenticated, service_role;