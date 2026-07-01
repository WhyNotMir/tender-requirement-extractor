import { parseArgs, envPath } from "./config";
import { log } from "./logger";

const cfg = parseArgs(process.argv.slice(2));
const hasKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());

log.info("run", "starting tender extractor", {
  inputDir: cfg.inputDir,
  outputDir: cfg.outputDir,
  useLlm: cfg.useLlm,
  envPath,
  deepseekKey: hasKey ? "present" : "missing",
});
