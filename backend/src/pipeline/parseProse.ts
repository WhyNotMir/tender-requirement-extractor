import { log } from "../logger";
import type { Line, PageInfo, Chunk } from "../types/internal";

// Prose tenders (e.g. Christmas Lights) have no position-number grammar; their
// structure lives in headings and numbered lists. We extract numbered list items
// as requirement chunks, grouped by the nearest section heading. Corrupted pages
// are still parsed: the numbered structure survives even when ligatures drop
// ("testing" -> "tesng"); OCR will repair the wording later.

const SECTION = /^(installation|testing|maintenance|dismantl\w*|specification)\b/i;
const ITEM = /^(\d{1,2})[.)]\s+(.{3,})$/;

export function parseProse(fileId: string, contentLines: Line[], _pageInfo: PageInfo[]): Chunk[] {
  const lines = [...contentLines].sort((a, b) => a.page - b.page || b.y - a.y);

  const chunks: Chunk[] = [];
  let section = "Specification";
  let idx = 0;

  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;

    if (SECTION.test(t) && t.length < 40) {
      section = t.replace(/[:.]+$/, "").trim();
      continue;
    }

    const m = t.match(ITEM);
    if (m) {
      const text = m[2]!.trim();
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
  }

  log.info("parseProse", "parsed prose requirements", { fileId, requirements: chunks.length });
  return chunks;
}
