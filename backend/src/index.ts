import "./pdf-quiet";
import { parseArgs } from "./config";
import { log } from "./logger";
import { ingest } from "./pipeline/ingest";
import { extract } from "./pipeline/extract";
import { classify } from "./pipeline/classify";
import { parseLv } from "./pipeline/parseLv";
import { buildLeaves } from "./pipeline/leaves";
import { consolidate } from "./pipeline/consolidate";
import { StubProvider } from "./llm/stub";
import type { Chunk, CandidateLeaf, Line } from "./types/internal";

function detectLanguage(text: string): "de" | "en" {
  const de = (text.match(/\b(und|der|die|das|liefern|montieren|gemäß|Stück)\b/gi) ?? []).length;
  const en = (text.match(/\b(the|and|shall|must|contractor|installation)\b/gi) ?? []).length;
  return de >= en ? "de" : "en";
}

function findModalityLegend(lines: Line[]): string | null {
  const joined = lines.map((l) => l.text).join("\n");
  const m = joined.match(/(Mindest|Muss|zwingend)[^\n]{0,200}/i);
  return m ? m[0] : null;
}

try {
  const cfg = parseArgs(process.argv.slice(2));
  const provider = new StubProvider();

  log.info("run", "starting tender extractor", {
    inputDir: cfg.inputDir,
    outputDir: cfg.outputDir,
    useLlm: cfg.useLlm,
    provider: provider.name,
    deepseekKey: process.env.DEEPSEEK_API_KEY?.trim() ? "present" : "missing",
  });

  const manifest = await ingest(cfg.inputDir);
  const allChunks: Chunk[] = [];
  const allLeaves: CandidateLeaf[] = [];

  for (const file of manifest.files) {
    const extracted = await extract(cfg.inputDir, file);
    file.pages = extracted.pages;
    file.language = detectLanguage(extracted.lines.map((l) => l.text).join(" "));

    const { contentLines } = classify(extracted.lines, extracted.pageInfo);
    const { chunks, titles, groups } = parseLv(file.fileId, contentLines);
    allChunks.push(...chunks);

    const legend = findModalityLegend(contentLines);
    const leaves = await buildLeaves(file.fileId, file.language, chunks, titles, groups, provider, legend);
    allLeaves.push(...leaves);
  }

  const consolidated = consolidate(allLeaves);

  log.info("run", "consolidate complete", {
    files: manifest.files.length,
    positions: allChunks.filter((c) => c.kind === "position").length,
    leavesIn: allLeaves.length,
    leavesOut: consolidated.length,
  });
} catch (error) {
  log.error("run", "fatal", { message: (error as Error).message });
  process.exit(1);
}
