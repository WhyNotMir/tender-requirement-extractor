import { log } from "../logger";
import type { Line, PageInfo, PageKind } from "../types/internal";

// Normalize a line so repeated chrome collapses to one key: digits -> "#".
const norm = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();

export interface ClassifyResult {
  contentLines: Line[];
  chromeKeys: Set<string>;
  pageInfo: PageInfo[];
}

// Chrome = lines whose normalized text repeats across a large share of pages
// (footers, planner address, "Übertrag", "Seite n von N").
function detectChrome(lines: Line[], pages: number): Set<string> {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = norm(l.text);
    if (k.length < 4) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.floor(pages * 0.4));
  const chrome = new Set<string>();
  for (const [k, count] of counts) if (count >= threshold) chrome.add(k);
  return chrome;
}

function classifyPage(pageLines: Line[]): PageKind {
  const text = pageLines.map((l) => l.text).join("\n");
  const low = text.toLowerCase();

  if (/inhaltsverzeichnis|table of contents/.test(low)) return "toc";

  if (
    /zusammenstellung|summe\s|gesamtbetrag|mwst|\bust\b|übertrag/.test(low) &&
    !/^\s*\d{2}\.\d{2}\.\d{4}/m.test(text)
  ) {
    const sums = (low.match(/summe|zusammenstellung|übertrag|mwst|\bust\b/g) ?? []).length;
    const positions = (text.match(/^\s*\d{2}\.\d{2}\.\d{4}/gm) ?? []).length;
    if (sums > positions) return "recap";
  }

  if (/vorbemerkungen|vertragstexte|background|general conditions|gegenstand der ausschreibung/.test(low))
    return "preamble";

  if (/^\s*\d{2}\.\d{2}\.\d{4}/m.test(text) || /\bOZ\b.*Menge.*Einheit/.test(text)) return "lv_positions";

  if (/^\s*\d+\.\s+[A-Z]/m.test(text) && /installation|maintenance|specification|dismantl|testing/i.test(low))
    return "prose_spec";

  if (/contractor details|checklist|tick|please complete|einzutragen/.test(low)) return "form";

  return "unknown";
}

export function classify(lines: Line[], pageInfo: PageInfo[]): ClassifyResult {
  const pages = pageInfo.length;
  const chromeKeys = detectChrome(lines, pages);
  const contentLines = lines.filter((l) => !chromeKeys.has(norm(l.text)));

  const byPage = new Map<number, Line[]>();
  for (const l of contentLines) {
    const arr = byPage.get(l.page) ?? [];
    arr.push(l);
    byPage.set(l.page, arr);
  }
  for (const pi of pageInfo) {
    pi.kind = classifyPage(byPage.get(pi.page) ?? []);
  }

  log.info("classify", "chrome removed and pages classified", {
    fileId: pageInfo[0]?.fileId,
    chromePatterns: chromeKeys.size,
    removed: lines.length - contentLines.length,
    pageKinds: pageInfo.reduce<Record<string, number>>(
      (acc, p) => ((acc[p.kind] = (acc[p.kind] ?? 0) + 1), acc),
      {},
    ),
  });
  return { contentLines, chromeKeys, pageInfo };
}
