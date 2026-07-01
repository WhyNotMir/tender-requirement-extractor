import "./pdf-quiet";
import { parseArgs } from "./config";
import { log } from "./logger";
import { ingest } from "./pipeline/ingest";
import { extract } from "./pipeline/extract";
import { classify } from "./pipeline/classify";
import { parseLv } from "./pipeline/parseLv";
import type { Chunk } from "./types/internal";

try {
  const cfg = parseArgs(process.argv.slice(2));
  const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());

  log.info("run", "starting tender extractor", {
    inputDir: cfg.inputDir,
    outputDir: cfg.outputDir,
    useLlm: cfg.useLlm,
    deepseekKey: hasKey ? "present" : "missing",
  });

  const manifest = await ingest(cfg.inputDir);
  const allChunks: Chunk[] = [];

  for (const file of manifest.files) {
    const extracted = await extract(cfg.inputDir, file);
    file.pages = extracted.pages;
    const { contentLines } = classify(extracted.lines, extracted.pageInfo);
    const { chunks } = parseLv(file.fileId, contentLines);
    allChunks.push(...chunks);
  }

  log.info("run", "parse complete", {
    files: manifest.files.length,
    positions: allChunks.filter((c) => c.kind === "position").length,
  });
} catch (error) {
  log.error("run", "fatal", { message: (error as Error).message });
  process.exit(1);
}
