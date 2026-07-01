import type { Chunk, CandidateLeaf } from "../types/internal";

// The pipeline talks to any LLM only through this interface. The deterministic
// stub implements it with zero network calls; a DeepSeek adapter implements the
// same shape later without touching any pipeline stage.

export interface EnrichInput {
  chunk: Chunk;
  modalityLegend: string | null; // the tender's own must/should definitions
  language: string;
}

export interface EnrichResult {
  bulletPoint: string;
  description: string;
  priority: "must" | "should" | "optional";
  equivalenceAllowed: boolean | null;
  confidence: "high" | "medium" | "low";
}

export interface LlmProvider {
  readonly name: string;
  // Enrich a single requirement chunk into the human-facing leaf fields.
  enrichLeaf(input: EnrichInput): Promise<EnrichResult>;
  // Verify a proposed consolidation merge (does the chunk belong to the leaf?).
  verifyMerge(leaf: CandidateLeaf, candidate: Chunk): Promise<boolean>;
}
