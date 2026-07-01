import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../logger";
import type { Line, PageInfo, FileEntry } from "../types/internal";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// pdfjs prints canvas-polyfill warnings that are irrelevant to text extraction
// and pollute the JSON log stream; drop just those, keep everything else.
const originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (String(args[0] ?? "").includes("Cannot polyfill")) return;
  originalWarn(...args);
};

export interface ExtractedFile {
  fileId: string;
  pages: number;
  lines: Line[];
  pageInfo: PageInfo[];
}

// A page is "corrupted" when extractable text shows the broken-ligature
// signature ("Installa on", "tes ng") or Unicode replacement / "Æ" artifacts.
function scoreQuality(text: string): "clean" | "corrupted" | "image_only" {
  const t = text.trim();
  if (t.length < 15) return "image_only";
  const brokenLigatures = (t.match(/[a-z] (?:on|ng|ed|ce|er|ts)\b/g) ?? []).length;
  const artifacts = (t.match(/[�]|Æ|ﬁ|ﬂ/g) ?? []).length;
  const words = t.split(/\s+/).length;
  const ratio = (brokenLigatures + artifacts) / Math.max(words, 1);
  if (artifacts > 2 || ratio > 0.06) return "corrupted";
  return "clean";
}

function reconstructLines(
  items: { str: string; x: number; y: number }[],
  page: number,
): Line[] {
  const TOL = 3;
  const rows: { y: number; toks: { x: number; str: string }[] }[] = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) <= TOL);
    if (!row) {
      row = { y: it.y, toks: [] };
      rows.push(row);
    }
    row.toks.push({ x: it.x, str: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => {
    const toks = r.toks.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd = -Infinity;
    for (const tk of toks) {
      if (text && tk.x - prevEnd > 1.5) text += " ";
      text += tk.str;
      prevEnd = tk.x + tk.str.length;
    }
    return { page, y: r.y, x: toks[0]?.x ?? 0, text: text.replace(/\s+/g, " ").trim() };
  });
}

export async function extract(inputDir: string, file: FileEntry): Promise<ExtractedFile> {
  const data = new Uint8Array(await readFile(join(inputDir, file.filename)));
  const doc = await getDocument({ data, useSystemFonts: false, verbosity: 0 }).promise;

  const lines: Line[] = [];
  const pageInfo: PageInfo[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((i: any) => typeof i.str === "string")
      .map((i: any) => ({ str: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number }));

    const pageLines = reconstructLines(items, p);
    lines.push(...pageLines);

    const pageText = pageLines.map((l) => l.text).join("\n");
    const quality = scoreQuality(pageText);
    pageInfo.push({
      fileId: file.fileId,
      page: p,
      kind: "unknown",
      textQuality: quality,
      charCount: pageText.length,
      method: quality === "image_only" ? "image_only" : "text",
    });
    if (quality !== "clean") {
      log.warn("extract", `page ${p} quality=${quality} -> route to OCR/repair later`, {
        fileId: file.fileId,
        page: p,
      });
    }
  }

  log.info("extract", `extracted ${doc.numPages} page(s)`, {
    fileId: file.fileId,
    corrupted: pageInfo.filter((pi) => pi.textQuality === "corrupted").length,
    imageOnly: pageInfo.filter((pi) => pi.textQuality === "image_only").length,
  });
  return { fileId: file.fileId, pages: doc.numPages, lines, pageInfo };
}
