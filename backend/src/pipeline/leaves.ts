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
  const items = chunks.filter((c) => c.kind === "position" || c.kind === "paragraph");
  const leaves: CandidateLeaf[] = [];

  for (const chunk of items) {
    const enriched = await provider.enrichLeaf({ chunk, modalityLegend, language });

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

    leaves.push({
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
    });
  }

  log.info("leaves", "built candidate leaves", {
    fileId,
    provider: provider.name,
    leaves: leaves.length,
  });
  return leaves;
}
