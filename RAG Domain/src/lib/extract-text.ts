import type { Page } from "./rag/chunk";

export type ExtractResult = { pages: Page[]; mimeType: string };

const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|json|log|ya?ml|html?|tsx?|jsx?|py|sql)$/i;

/** Parse files in the browser so the server never handles binary payloads. */
export async function extractText(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

    const buffer = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const pages: Page[] = [];

    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) pages.push({ page: index, text });
    }

    if (pages.length === 0) {
      throw new Error("This PDF has no selectable text — it's likely a scan and would need OCR.");
    }
    return { pages, mimeType: "application/pdf" };
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser.js");
    const buffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = value.trim();
    if (!text) throw new Error("No readable text found in this document.");
    return {
      pages: [{ page: 1, text }],
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (TEXT_EXTENSIONS.test(name) || file.type.startsWith("text/")) {
    const text = (await file.text()).trim();
    if (!text) throw new Error("This file is empty.");
    return { pages: [{ page: 1, text }], mimeType: file.type || "text/plain" };
  }

  throw new Error("Unsupported file type. Upload a PDF, DOCX, TXT, or Markdown file.");
}
