import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PageSchema = z.object({ page: z.number().int(), text: z.string() });

const IngestSchema = z.object({
  filename: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(200),
  pages: z.array(PageSchema).min(1).max(2000),
});

const AskSchema = z.object({ question: z.string().min(3).max(1000) });

const DeleteSchema = z.object({ documentId: z.string().uuid() });

export const ingestDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => IngestSchema.parse(input))
  .handler(async ({ data }) => {
    const { ingest } = await import("./rag/pipeline.server");
    return ingest(data);
  });

export const askQuestion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AskSchema.parse(input))
  .handler(async ({ data }) => {
    const { ask } = await import("./rag/pipeline.server");
    return ask(data.question);
  });

export const listDocuments = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("id, filename, mime_type, page_count, word_count, chunk_count, status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const deleteDocument = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("documents").delete().eq("id", data.documentId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
