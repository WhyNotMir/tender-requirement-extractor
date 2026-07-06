import { log } from "../logger";
import type { Line, PageInfo, FileEntry, Chunk, CandidateLeaf } from "../types/internal";
import type { LlmProvider } from "../llm/provider";

// General conditions in the preamble (insurance, H&S, standards, deadlines) are
// obligations too, but they are prose, not numbered positions. We hand the
// preamble text to the provider, which returns discrete obligations; each
// becomes a Level-3 leaf under a "General Conditions" Level-1 branch.
export async function extractPreamble(
  file: FileEntry,
  contentLines: Line[],
  pageInfo: PageInfo[],
  provider: LlmProvider,
  language: string,
): Promise<{ chunks: Chunk[]; leaves: CandidateLeaf[] }> {
  const preamblePages = new Set(pageInfo.filter((p) => p.kind === "preamble").map((p) => p.page));
  if (preamblePages.size === 0) return { chunks: [], leaves: [] };

  const text = contentLines
    .filter((l) => preamblePages.has(l.page))
    .map((l) => l.text)
    .join("\n");
  if (text.trim().length < 50) return { chunks: [], leaves: [] };

  const obligations = await provider.extractObligations({ text, language });

  const chunks: Chunk[] = [];
  const leaves: CandidateLeaf[] = [];
  obligations.forEach((o, i) => {
    const id = `${file.fileId}:preamble:${i}`;
    chunks.push({
      id,
      fileId: file.fileId,
      page: 0,
      kind: "preamble",
      ozCode: null,
      title: o.bulletPoint,
      text: o.description,
      quantity: null,
      equivalence: null,
      section: "General Conditions",
    });
    leaves.push({
      bulletPoint: o.bulletPoint,
      descriptionSource: o.description,
      language,
      priority: o.priority,
      equivalenceAllowed: null,
      confidence: "medium", // prose-extracted, less certain than a parsed position
      chunkIds: [id],
      level1Key: "General Conditions",
      level1Label: "General Conditions",
      level2Key: "General Conditions:obl",
      level2Label: "Obligations",
    });
  });

  log.info("preamble", "extracted preamble obligations", {
    fileId: file.fileId,
    provider: provider.name,
    obligations: leaves.length,
  });
  return { chunks, leaves };
}
