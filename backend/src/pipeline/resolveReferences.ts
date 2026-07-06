import { log } from "../logger";
import type { CandidateLeaf, Chunk, Manifest } from "../types/internal";

// Cross-reference resolution. Two kinds:
//  - internal: `Position "X"` -> attach that position's chunks onto this leaf.
//  - external: `Grundriss/Protokoll/...` -> a referenced annex; if that file is
//    not present in the tender folder, flag the leaf (confidence medium) and log
//    it as unresolved rather than silently dropping the dependency.
const RE_INTERNAL = /Position\s+["„“»«]([^"„“»«]{2,50})["„“»«]/g;
const RE_EXTERNAL = /\b(Grundriss\w*|Montageplan\w*|Protokoll\w*|Terminplan\w*|Bestandsm\w*|Ansichtszeichn\w*|Beilage\w*)/i;

export interface ReferenceReport {
  scannedLeaves: number;
  internalResolved: number;
  externalUnresolved: number;
  unresolved: { leafBulletPoint: string; reference: string }[];
}

export function resolveReferences(
  leaves: CandidateLeaf[],
  chunks: Chunk[],
  manifest: Manifest,
): ReferenceReport {
  const index = leaves.map((l) => ({ leaf: l, name: l.bulletPoint.toLowerCase() }));
  const hasAnnexFiles = manifest.files.some((f) => f.roleGuess === "annex");
  // Scan the ORIGINAL source text (not the LLM-rephrased description), so
  // reference detection is independent of enrichment wording.
  const chunkText = new Map(chunks.map((c) => [c.id, c.text]));

  let internalResolved = 0;
  const unresolved: { leafBulletPoint: string; reference: string }[] = [];

  for (const leaf of leaves) {
    const text = leaf.chunkIds.map((id) => chunkText.get(id) ?? "").join("\n") || leaf.descriptionSource;

    for (const m of text.matchAll(RE_INTERNAL)) {
      const name = m[1]!.trim().toLowerCase();
      if (name.length < 3) continue;
      const target = index.find((x) => x.leaf !== leaf && x.name.includes(name));
      if (target) {
        const before = leaf.chunkIds.length;
        leaf.chunkIds = Array.from(new Set([...leaf.chunkIds, ...target.leaf.chunkIds]));
        if (leaf.chunkIds.length > before) internalResolved++;
      }
    }

    const ext = text.match(RE_EXTERNAL);
    if (ext && !hasAnnexFiles) {
      if (leaf.confidence === "high") leaf.confidence = "medium";
      unresolved.push({ leafBulletPoint: leaf.bulletPoint.slice(0, 60), reference: ext[0] });
    }
  }

  const report: ReferenceReport = {
    scannedLeaves: leaves.length,
    internalResolved,
    externalUnresolved: unresolved.length,
    unresolved: unresolved.slice(0, 50),
  };
  log.info("resolveRefs", "reference resolution complete", {
    scannedLeaves: report.scannedLeaves,
    internalResolved: report.internalResolved,
    externalUnresolved: report.externalUnresolved,
  });
  return report;
}
