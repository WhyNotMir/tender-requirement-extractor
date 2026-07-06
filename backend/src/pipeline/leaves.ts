import { log } from "../logger";
import type { Chunk, CandidateLeaf } from "../types/internal";
import type { LlmProvider } from "../llm/provider";
import { StubProvider } from "../llm/stub";

export interface BuildOptions {
  concurrency: number;
  budget?: { remaining: number }; // shared LLM-call budget; undefined = unlimited
}

// Run an async mapper over items with a bounded number of concurrent workers,
// preserving input order in the result.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const stubFallback = new StubProvider();

// Turn requirement chunks into candidate leaves via the provider. Grouping keys
// come from the OZ code so the tree mirrors the document's own structure.
export async function buildLeaves(
  fileId: string,
  language: string,
  chunks: Chunk[],
  titles: Map<string, string>,
  groups: Map<string, string>,
  provider: LlmProvider,
  modalityLegend: string | null,
  opts: BuildOptions = { concurrency: 1 },
): Promise<CandidateLeaf[]> {
  const items = chunks.filter((c) => c.kind === "position" || c.kind === "paragraph");

  const leaves = await mapLimit(items, opts.concurrency, async (chunk) => {
    // Spend the LLM budget first; beyond it, fall back to the deterministic stub.
    const useLlm = !opts.budget || opts.budget.remaining > 0;
    if (opts.budget && useLlm) opts.budget.remaining -= 1;
    const active = useLlm ? provider : stubFallback;
    const enriched = await active.enrichLeaf({ chunk, modalityLegend, language });

    // Grouping path: from the OZ code (LV) or the section heading (prose).
    let level1Key: string, level1Label: string, level2Key: string, level2Label: string;
    if (chunk.ozCode) {
      const parts = chunk.ozCode.split(".");
      const roomCoded = /[A-Za-zÄÖÜäöü]/.test(parts[0] ?? "");
      level1Key = chunk.ozCode.slice(0, 2);
      level1Label = titles.get(level1Key) ?? `Section ${level1Key}`;
      if (roomCoded) {
        // Salzburg: floor -> subgroup (3-part key carries a captured label).
        const subKey = parts.slice(0, 3).join(".");
        const ogKey = parts.slice(0, 2).join(".");
        level2Key = subKey;
        level2Label = groups.get(subKey) ?? groups.get(ogKey) ?? `Group ${subKey}`;
      } else {
        level2Key = parts.slice(0, 2).join(".");
        level2Label = groups.get(level2Key) ?? `Group ${level2Key}`;
      }
    } else {
      const section = chunk.section ?? "Specification";
      level1Key = section;
      level1Label = section;
      level2Key = `${section}:req`;
      level2Label = "Requirements";
    }

    const leaf: CandidateLeaf = {
      bulletPoint: chunk.quantity ? `${enriched.bulletPoint} (${chunk.quantity})` : enriched.bulletPoint,
      descriptionSource: enriched.description,
      language,
      priority: enriched.priority,
      equivalenceAllowed: enriched.equivalenceAllowed,
      confidence: enriched.confidence,
      chunkIds: [chunk.id],
      level1Key,
      level1Label,
      level2Key,
      level2Label,
    };
    return leaf;
  });

  log.info("leaves", "built candidate leaves", {
    fileId,
    provider: provider.name,
    leaves: leaves.length,
  });
  return leaves;
}
