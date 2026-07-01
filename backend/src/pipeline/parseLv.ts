import { log } from "../logger";
import type { Line, Chunk } from "../types/internal";

// Structure-first: the position-number grammar carries the tree, so we recover
// leaf candidates deterministically before any LLM is involved. Two grammars:
// GAEB OZ (NN.NN.NNNN, Fahrradgaragen) and Salzburg's room-coded scheme
// (e.g. GU.20.05.01.01), where the code is glued to the title with no space.

const cleanLabel = (s: string) => s.replace(/[.\s]+$/g, "").replace(/\s+/g, " ").trim();

// GAEB grammar.
const RE_POSITION = /^(\d{2}\.\d{2}\.\d{4})\s+(.*)$/;
const RE_GROUP = /^(\d{2}\.\d{2})\s+(.*)$/;
const RE_TITLE = /^(\d{2})\s+(.+)$/;

// Salzburg room-coded grammar: 2-char prefix (letter + letter/digit) then four
// two-digit segments for a position, one or two for a group header. Positions
// have no space before the title; group headers do.
const RE_POSITION_ROOM = /^([A-ZÄÖÜ][A-ZÄÖÜ0-9](?:\.\d{2}){4})\s*(.*)$/;
const RE_GROUP_ROOM = /^([A-ZÄÖÜ][A-ZÄÖÜ0-9](?:\.\d{2}){1,2})\s+(.*)$/;
const RE_QTY = /^([\d.,]+)\s*(St|Stk|psch|pausch|m²|m2|m³|lfm|kg|Stck|Stück|h|Pa)\b/i;
const RE_RECAP_LINE = /^(summe|zusammenstellung|übertrag)\b/i;

interface OpenPosition {
  code: string;
  page: number;
  title: string;
  body: string[];
  qty: string | null;
}

export interface ParsedLv {
  chunks: Chunk[];
  titles: Map<string, string>; // "01" -> "Fahrradgaragen Marienkirchplatz"
  groups: Map<string, string>; // "01.01" -> "Fahrradgaragen"
}

export function parseLv(fileId: string, contentLines: Line[]): ParsedLv {
  const titles = new Map<string, string>();
  const groups = new Map<string, string>();
  const chunks: Chunk[] = [];

  // Walk lines in reading order (page, then top-to-bottom).
  const lines = [...contentLines].sort((a, b) => a.page - b.page || b.y - a.y);

  let cur: OpenPosition | null = null;
  const flush = () => {
    if (!cur) return;
    const text = [cur.title, ...cur.body].join("\n").replace(/\n{2,}/g, "\n").trim();
    const isVoid = /\bentfällt\b/i.test(text) && text.length < 40;
    chunks.push({
      id: `${fileId}:p${cur.page}:${cur.code}`,
      fileId,
      page: cur.page,
      kind: isVoid ? "void" : "position",
      ozCode: cur.code,
      title: cur.title || null,
      text,
      quantity: cur.qty,
      equivalence: /\boder gleichwertig\b/i.test(text) ? true : null,
    });
    cur = null;
  };

  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;

    const mPos = t.match(RE_POSITION) ?? t.match(RE_POSITION_ROOM);
    if (mPos) {
      flush();
      cur = { code: mPos[1]!, page: l.page, title: (mPos[2] ?? "").trim(), body: [], qty: null };
      continue;
    }

    const mGroup = t.match(RE_GROUP) ?? t.match(RE_GROUP_ROOM);
    if (mGroup) {
      flush(); // a group header closes any open position
      groups.set(mGroup[1]!, cleanLabel(mGroup[2] ?? ""));
      continue;
    }

    const mTitle = t.match(RE_TITLE);
    if (mTitle && !cur) {
      titles.set(mTitle[1]!, cleanLabel(mTitle[2] ?? ""));
      continue;
    }

    if (RE_RECAP_LINE.test(t)) {
      flush();
      continue;
    }

    if (cur) {
      const mQty = t.match(RE_QTY);
      if (mQty) cur.qty = `${mQty[1]} ${mQty[2]}`.trim();
      // drop dotted price-blank leaders and column headers
      if (!/^[.\s]+$/.test(t) && !/^OZ\b/.test(t) && !/Einheitspreis|Gesamtbetrag/.test(t)) {
        cur.body.push(t);
      }
    }
  }
  flush();

  const positions = chunks.filter((c) => c.kind === "position");
  log.info("parseLv", "parsed LV positions", {
    fileId,
    titles: titles.size,
    groups: groups.size,
    positions: positions.length,
    voids: chunks.filter((c) => c.kind === "void").length,
    withEquivalence: positions.filter((c) => c.equivalence).length,
  });
  return { chunks, titles, groups };
}
