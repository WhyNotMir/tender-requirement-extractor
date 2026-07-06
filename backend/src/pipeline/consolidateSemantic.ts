import { log } from "../logger";
import type { CandidateLeaf, Chunk } from "../types/internal";
import type { LlmProvider } from "../llm/provider";

// Semantic consolidation — the capability the brief weighs hardest, in its full
// form. Exact-id consolidation only catches identical bulletPoints; here we find
// near-duplicate leaves by lexical similarity (a provider-agnostic stand-in for
// embeddings) and confirm EACH proposed merge with the LLM verifier before
// unioning. Budget-capped, and a no-op on the stub (verifyMerge always false).

const tokenize = (s: string): Set<string> =>
  new Set(s.toLowerCase().match(/[a-zäöüß0-9]{3,}/g) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function chunkFromLeaf(leaf: CandidateLeaf): Chunk {
  return {
    id: leaf.chunkIds[0] ?? "",
    fileId: "",
    page: 0,
    kind: "position",
    ozCode: null,
    title: leaf.bulletPoint,
    text: leaf.descriptionSource,
    quantity: null,
    equivalence: leaf.equivalenceAllowed,
  };
}

export async function consolidateSemantic(
  leaves: CandidateLeaf[],
  provider: LlmProvider,
  budget: number,
): Promise<CandidateLeaf[]> {
  if (budget <= 0) return leaves;

  // Block by Level-2 (subgroup): merge only near-duplicate leaves within the same
  // subgroup. This deliberately avoids merging identical positions that repeat
  // across rooms (different subgroups) — those are separate quantities, not the
  // same requirement. Cross-document linking is left to production (real
  // embeddings + human review); see the weakness notes.
  const blocks = new Map<string, CandidateLeaf[]>();
  for (const l of leaves) {
    const key = `${l.level1Key}||${l.level2Key}`;
    const arr = blocks.get(key) ?? [];
    arr.push(l);
    blocks.set(key, arr);
  }

  const merged = new Set<CandidateLeaf>();
  let candidates = 0;
  let verified = 0;
  let calls = 0;

  for (const group of blocks.values()) {
    if (calls >= budget) break;
    const toks = group.map((l) => tokenize(`${l.bulletPoint} ${l.descriptionSource.slice(0, 200)}`));
    for (let i = 0; i < group.length && calls < budget; i++) {
      if (merged.has(group[i]!)) continue;
      for (let j = i + 1; j < group.length && calls < budget; j++) {
        if (merged.has(group[j]!)) continue;
        const sim = jaccard(toks[i]!, toks[j]!);
        if (sim < 0.7) continue; // not similar enough to be the same requirement
        candidates++;
        calls++;
        const ok = await provider.verifyMerge(group[i]!, chunkFromLeaf(group[j]!));
        if (!ok) continue;
        group[i]!.chunkIds = Array.from(new Set([...group[i]!.chunkIds, ...group[j]!.chunkIds]));
        if (group[j]!.equivalenceAllowed) group[i]!.equivalenceAllowed = true;
        merged.add(group[j]!);
        verified++;
      }
    }
  }

  log.info("semanticMerge", "semantic consolidation complete", {
    verifyCalls: calls,
    candidates,
    merged: verified,
  });
  return leaves.filter((l) => !merged.has(l));
}
