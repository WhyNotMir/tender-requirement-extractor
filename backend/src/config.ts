import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface RunConfig {
  inputDir: string;
  outputDir: string;
  useLlm: boolean;
  llmConcurrency: number;
  llmMax: number; // max LLM-enriched leaves for the whole run; Infinity = no cap
  mergeMax: number; // max verifyMerge calls in semantic consolidation
}

// Load env/.env once, centrally, resolved relative to this file.
const here = dirname(fileURLToPath(import.meta.url));
export const envPath = resolve(here, "../../env/.env");
loadEnv({ path: envPath });

export function parseArgs(argv: string[]): RunConfig {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i++;
    } else {
      args.set(key, "true");
    }
  }

  const inputDir = args.get("input");
  if (!inputDir) {
    throw new Error(
      "Usage: npm start -- --input <tenderFolder> [--output <dir>] [--use-llm] [--llm-concurrency N] [--llm-max N]",
    );
  }
  return {
    inputDir,
    outputDir: args.get("output") ?? "output",
    useLlm: args.get("use-llm") === "true",
    llmConcurrency: Math.max(1, Number(args.get("llm-concurrency")) || 6),
    llmMax: args.has("llm-max") ? Number(args.get("llm-max")) : Infinity,
    mergeMax: args.has("merge-max") ? Number(args.get("merge-max")) : 60,
  };
}
