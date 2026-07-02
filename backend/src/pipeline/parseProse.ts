import { log } from "../logger";
import type { Line, PageInfo, Chunk } from "../types/internal";

// Prose tenders have no position-number grammar; their structure lives in
// headings and lists. We detect section headings structurally (not by a fixed
// keyword list) and capture numbered and bulleted list items as requirement
// chunks. Corrupted pages are still parsed: the list structure survives even
// when ligatures drop ("testing" -> "tesng"); OCR repairs the wording later.

// Keyword booster for common section names (kept small; structure does the work).
const SECTION_WORDS =
  /^(installation|testing|maintenance|dismantl\w*|specification|delivery|warranty|scope|requirements?|general|payment|insurance|health|safety|submission)\b/i;

const ITEM_NUM = /^(\d{1,2})[.)]\s+(.{3,})$/;
const ITEM_BULLET = /^[•·▪◦*‐-―-]\s+(.{3,})$/;

function isHeading(t: string): boolean {
  if (t.length < 3 || t.length > 60) return false;
  if (/[.!?]$/.test(t)) return false; // a full sentence is not a heading
  if (/:$/.test(t)) return true; // "Requirements:"
  const words = t.split(/\s+/).length;
  const letters = t.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && words <= 6) return true; // ALL CAPS
  if (SECTION_WORDS.test(t) && words <= 6) return true;
  return false;
}

export function parseProse(fileId: string, contentLines: Line[], _pageInfo: PageInfo[]): Chunk[] {
  const lines = [...contentLines].sort((a, b) => a.page - b.page || b.y - a.y);

  const chunks: Chunk[] = [];
  let section = "Specification";
  let idx = 0;

  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;

    if (isHeading(t)) {
      section = t.replace(/[:.]+$/, "").trim();
      continue;
    }

    const mNum = t.match(ITEM_NUM);
    const mBul = t.match(ITEM_BULLET);
    const text = mNum ? mNum[2]!.trim() : mBul ? mBul[1]!.trim() : null;
    if (!text) continue;

    chunks.push({
      id: `${fileId}:p${l.page}:b${idx++}`,
      fileId,
      page: l.page,
      kind: "paragraph",
      ozCode: null,
      title: text.slice(0, 80),
      text,
      quantity: null,
      equivalence: null,
      section,
    });
  }

  log.info("parseProse", "parsed prose requirements", { fileId, requirements: chunks.length });
  return chunks;
}
