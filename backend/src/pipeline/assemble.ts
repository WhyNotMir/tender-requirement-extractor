import { log } from "../logger";
import type { CandidateLeaf } from "../types/internal";
import type { ProcurementMatchDeliverable, LocaleObject } from "../types/procurement";
import { downstreamDefaults } from "../types/procurement";

// Build the 3-level tree. L1/L2 grouping nodes are derived from the document's
// own structure (title/group keys); we do not invent levels. Level 3 leaves
// carry the requirement and its source chunks.
function node(
  bulletPoint: string,
  description: LocaleObject<string>,
  partial: Partial<ProcurementMatchDeliverable>,
): ProcurementMatchDeliverable {
  return {
    bulletPoint,
    description,
    priority: "must",
    confidence: null,
    equivalenceAllowed: null,
    deliverableArray: [],
    procurementDocumentChunkIdArray: [],
    ...downstreamDefaults,
    ...partial,
  };
}

export function assembleTree(leaves: CandidateLeaf[]): ProcurementMatchDeliverable[] {
  const l1Map = new Map<string, ProcurementMatchDeliverable>();
  const l2Map = new Map<string, ProcurementMatchDeliverable>();

  for (const leaf of leaves) {
    if (!l1Map.has(leaf.level1Key)) {
      l1Map.set(leaf.level1Key, node(leaf.level1Label, { [leaf.language]: leaf.level1Label }, {}));
    }

    const l2k = `${leaf.level1Key}/${leaf.level2Key}`;
    if (!l2Map.has(l2k)) {
      const l2 = node(leaf.level2Label, { [leaf.language]: leaf.level2Label }, {});
      l2Map.set(l2k, l2);
      l1Map.get(leaf.level1Key)!.deliverableArray.push(l2);
    }

    const leafNode = node(leaf.bulletPoint, { [leaf.language]: leaf.descriptionSource }, {
      priority: leaf.priority,
      confidence: leaf.confidence,
      equivalenceAllowed: leaf.equivalenceAllowed,
      procurementDocumentChunkIdArray: leaf.chunkIds,
    });
    l2Map.get(l2k)!.deliverableArray.push(leafNode);
  }

  const tree = [...l1Map.values()];
  log.info("assemble", "tree assembled", {
    level1: tree.length,
    level2: l2Map.size,
    level3: leaves.length,
  });
  return tree;
}
