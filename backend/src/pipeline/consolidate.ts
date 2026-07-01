import { log } from "../logger";
import type { CandidateLeaf } from "../types/internal";

// Consolidation — the capability the brief weighs hardest. Merge scattered
// mentions of one requirement onto a single leaf, unioning all chunk ids.
// This slice does the exact-id merge (same group + bulletPoint); rule-scoped
// and embedding+verifier merges are added in later slices.
export function consolidate(leaves: CandidateLeaf[]): CandidateLeaf[] {
  const byKey = new Map<string, CandidateLeaf>();
  let merges = 0;

  for (const leaf of leaves) {
    const key = `${leaf.level2Key}|${leaf.bulletPoint}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.chunkIds = Array.from(new Set([...existing.chunkIds, ...leaf.chunkIds]));
      if (leaf.equivalenceAllowed) existing.equivalenceAllowed = true;
      merges++;
    } else {
      byKey.set(key, leaf);
    }
  }

  log.info("consolidate", "consolidation pass complete", {
    in: leaves.length,
    out: byKey.size,
    merges,
  });
  return [...byKey.values()];
}
