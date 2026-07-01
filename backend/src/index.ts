import "./pdf-quiet";
import { parseArgs } from "./config";
import { log } from "./logger";
import { ingest } from "./pipeline/ingest";
import { extract } from "./pipeline/extract";
import { classify } from "./pipeline/classify";

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

  for (const file of manifest.files) {
    const extracted = await extract(cfg.inputDir, file);
    file.pages = extracted.pages;
    classify(extracted.lines, extracted.pageInfo);
  }

  log.info("run", "classify complete", {
    files: manifest.files.length,
    totalPages: manifest.files.reduce((sum, f) => sum + f.pages, 0),
  });
} catch (error) {
  log.error("run", "fatal", { message: (error as Error).message });
  process.exit(1);
}
