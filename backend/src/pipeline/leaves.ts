import { log } from "../logger";
import type { Chunk, CandidateLeaf } from "../types/internal";
import type { LlmProvider } from "../llm/provider";

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
): Promise<CandidateLeaf[]> {
  const positions = chunks.filter((c) => c.kind === "position");
  const leaves: CandidateLeaf[] = [];

  for (const chunk of positions) {
    const oz = chunk.ozCode ?? "";
    const l1 = oz.slice(0, 2); // "01"
    const l2 = oz.split(".").slice(0, 2).join("."); // "01.01"
    const enriched = await provider.enrichLeaf({ chunk, modalityLegend, language });

    leaves.push({
      bulletPoint: chunk.quantity ? `${enriched.bulletPoint} (${chunk.quantity})` : enriched.bulletPoint,
      descriptionSource: enriched.description,
      language,
      priority: enriched.priority,
      equivalenceAllowed: enriched.equivalenceAllowed,
      confidence: enriched.confidence,
      chunkIds: [chunk.id],
      level1Key: l1,
      level1Label: titles.get(l1) ?? `Title ${l1}`,
      level2Key: l2,
      level2Label: groups.get(l2) ?? `Group ${l2}`,
    });
  }

  log.info("leaves", "built candidate leaves", {
    fileId,
    provider: provider.name,
    leaves: leaves.length,
  });
  return leaves;
}
