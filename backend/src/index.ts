import { parseArgs } from "./config";
import { log } from "./logger";
import { ingest } from "./pipeline/ingest";

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
  log.info("run", "ingest complete", {
    tenderId: manifest.tenderId,
    files: manifest.files.length,
  });
} catch (error) {
  log.error("run", "fatal", { message: (error as Error).message });
  process.exit(1);
}
