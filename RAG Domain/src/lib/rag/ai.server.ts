const GATEWAY = "https://ai.gateway.lovable.dev/v1";
export const EMBEDDING_MODEL = "google/gemini-embedding-001";
export const ANSWER_MODEL = "google/gemini-3.6-flash";

/** Gemini embeddings cap at 100 inputs per request; stay well under it. */
const EMBED_BATCH_SIZE = 50;

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured for this project.");
  return key;
}

class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function friendly(status: number, body: string): never {
  if (status === 429) throw new GatewayError(429, "AI rate limit reached — try again in a moment.");
  if (status === 402) throw new GatewayError(402, "AI credits exhausted. Add credits to keep going.");
  throw new GatewayError(status, `AI request failed (${status}): ${body.slice(0, 300)}`);
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const key = apiKey();
  const vectors: number[][] = [];

  for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
    const batch = inputs.slice(i, i + EMBED_BATCH_SIZE);
    const res = await fetch(`${GATEWAY}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });

    if (!res.ok) friendly(res.status, await res.text());

    const json = (await res.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) vectors.push(item.embedding);
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error("Failed to embed the question.");
  return vector;
}

export async function chatComplete(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
): Promise<string> {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({ model: ANSWER_MODEL, messages, temperature: 0.1 }),
  });

  if (!res.ok) friendly(res.status, await res.text());

  const json = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  return json.choices[0]?.message?.content?.trim() ?? "";
}
