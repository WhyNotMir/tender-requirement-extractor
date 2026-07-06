import "./pdf-quiet";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "./config";
import { log } from "./logger";
import { ingest } from "./pipeline/ingest";
import { extract } from "./pipeline/extract";
import { classify } from "./pipeline/classify";
import { parseLv } from "./pipeline/parseLv";
import { parseProse } from "./pipeline/parseProse";
import { buildLeaves } from "./pipeline/leaves";
import { extractPreamble } from "./pipeline/preamble";
import { consolidate } from "./pipeline/consolidate";
import { consolidateSemantic } from "./pipeline/consolidateSemantic";
import { resolveReferences } from "./pipeline/resolveReferences";
import { assembleTree } from "./pipeline/assemble";
import { validate } from "./pipeline/validate";
import { StubProvider } from "./llm/stub";
import { DeepSeekProvider } from "./llm/deepseek";
import type { LlmProvider } from "./llm/provider";
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

  let provider: LlmProvider;
  if (cfg.useLlm) {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("--use-llm requires DEEPSEEK_API_KEY in env/.env");
    }
    provider = new DeepSeekProvider({
      apiKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
    });
  } else {
    provider = new StubProvider();
  }

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
  const budget = Number.isFinite(cfg.llmMax) ? { remaining: cfg.llmMax } : undefined;
  const buildOpts = { concurrency: cfg.useLlm ? cfg.llmConcurrency : 1, budget };

  for (const file of manifest.files) {
    const extracted = await extract(cfg.inputDir, file);
    file.pages = extracted.pages;
    file.language = detectLanguage(extracted.lines.map((l) => l.text).join(" "));

    const { contentLines } = classify(extracted.lines, extracted.pageInfo);
    const { chunks, titles, groups } = parseLv(file.fileId, contentLines);
    const hasPositions = chunks.some((c) => c.kind === "position");

    // No position grammar matched -> prose tender; extract from numbered lists.
    const fileChunks = hasPositions
      ? chunks
      : [...chunks, ...parseProse(file.fileId, contentLines, extracted.pageInfo)];
    allChunks.push(...fileChunks);

    const legend = findModalityLegend(contentLines);
    const leaves = await buildLeaves(file.fileId, file.language, fileChunks, titles, groups, provider, legend, buildOpts);
    allLeaves.push(...leaves);

    // General conditions become obligations (Level-1 branch). For prose tenders
    // this also covers the contractual sections beyond the numbered list.
    const pre = await extractPreamble(
      file, contentLines, extracted.pageInfo, provider, file.language, !hasPositions,
    );
    allChunks.push(...pre.chunks);
    allLeaves.push(...pre.leaves);
  }

  const consolidated = consolidate(allLeaves);
  // Semantic merge (LLM-verified) runs only when the LLM is on; stub is a no-op.
  const deduped = cfg.useLlm
    ? await consolidateSemantic(consolidated, provider, cfg.mergeMax)
    : consolidated;
  const refReport = resolveReferences(deduped, allChunks, manifest);
  const tree = assembleTree(deduped);
  const report = validate(tree, allChunks);

  const outDir = join(cfg.outputDir, manifest.tenderId);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(outDir, "chunks.json"), JSON.stringify(allChunks, null, 2));
  await writeFile(join(outDir, "tree.json"), JSON.stringify(tree, null, 2));
  await writeFile(join(outDir, "coverage-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, "references.json"), JSON.stringify(refReport, null, 2));

  if (provider instanceof DeepSeekProvider) {
    log.info("run", "llm usage", {
      ...provider.usage,
      estimatedCostUsd: provider.estimatedCostUsd(),
    });
  }

  log.info("run", "done", {
    outDir,
    level1: tree.length,
    leaves: deduped.length,
    schemaValid: report.schemaValid,
  });
} catch (error) {
  log.error("run", "fatal", { message: (error as Error).message });
  process.exit(1);
}
