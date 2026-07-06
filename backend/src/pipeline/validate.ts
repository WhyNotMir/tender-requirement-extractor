import { z } from "zod";
import { log } from "../logger";
import { DeliverableSchema } from "../types/procurement";
import type { ProcurementMatchDeliverable } from "../types/procurement";
import type { Chunk } from "../types/internal";

// Schema validity alone is not enough; the coverage audit proves no real
// requirement was silently dropped: every content chunk must be referenced by a
// leaf or be explicit noise.
export interface CoverageReport {
  schemaValid: boolean;
  totalContentChunks: number;
  referencedChunks: number;
  orphanChunks: string[];
  leafCount: number;
  lowConfidenceLeaves: number;
  mustLeaves: number;
  // Faithfulness: fraction of a leaf's description content-words that appear in
  // its source chunks. ~1.0 for verbatim (stub); lower flags possible drift.
  avgGrounding: number;
  lowGroundingLeaves: number;
}

const contentTokens = (s: string): Set<string> =>
  new Set(s.toLowerCase().match(/[a-zäöüß0-9]{4,}/g) ?? []);

function grounding(
  leaf: ProcurementMatchDeliverable,
  chunkText: Map<string, string>,
): number {
  const desc = contentTokens(Object.values(leaf.description).join(" "));
  if (desc.size === 0) return 1;
  const src = contentTokens(
    leaf.procurementDocumentChunkIdArray.map((id) => chunkText.get(id) ?? "").join(" "),
  );
  let hit = 0;
  for (const t of desc) if (src.has(t)) hit++;
  return hit / desc.size;
}

function collectRefs(nodes: ProcurementMatchDeliverable[], acc: Set<string>): void {
  for (const n of nodes) {
    n.procurementDocumentChunkIdArray.forEach((id) => acc.add(id));
    collectRefs(n.deliverableArray, acc);
  }
}

function countLeaves(nodes: ProcurementMatchDeliverable[]): ProcurementMatchDeliverable[] {
  return nodes.flatMap((n) => (n.deliverableArray.length ? countLeaves(n.deliverableArray) : [n]));
}

export function validate(tree: ProcurementMatchDeliverable[], chunks: Chunk[]): CoverageReport {
  const parsed = z.array(DeliverableSchema).safeParse(tree);
  if (!parsed.success) log.error("validate", "schema invalid", parsed.error.issues.slice(0, 5));

  const refs = new Set<string>();
  collectRefs(tree, refs);

  const contentChunks = chunks.filter((c) =>
    ["position", "paragraph", "checklist", "preamble"].includes(c.kind),
  );
  const orphans = contentChunks.filter((c) => !refs.has(c.id)).map((c) => c.id);
  const leaves = countLeaves(tree);

  const chunkText = new Map(chunks.map((c) => [c.id, c.text]));
  const groundings = leaves.map((l) => grounding(l, chunkText));
  const avgGrounding = groundings.length
    ? Number((groundings.reduce((a, b) => a + b, 0) / groundings.length).toFixed(3))
    : 1;

  const report: CoverageReport = {
    schemaValid: parsed.success,
    totalContentChunks: contentChunks.length,
    referencedChunks: contentChunks.length - orphans.length,
    orphanChunks: orphans,
    leafCount: leaves.length,
    lowConfidenceLeaves: leaves.filter((l) => l.confidence === "low").length,
    mustLeaves: leaves.filter((l) => l.priority === "must").length,
    avgGrounding,
    lowGroundingLeaves: groundings.filter((g) => g < 0.5).length,
  };

  log.info("validate", "coverage audit complete", report);
  if (orphans.length) log.warn("validate", `${orphans.length} orphan chunk(s) not in any leaf`, { orphans });
  return report;
}
