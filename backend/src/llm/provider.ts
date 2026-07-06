import type { Chunk, CandidateLeaf } from "../types/internal";

// The pipeline talks to any LLM only through this interface. The deterministic
// stub implements it with zero network calls; an OpenAI-compatible HTTP adapter
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

// A single obligation extracted from free prose (preamble / general conditions).
export interface Obligation {
  bulletPoint: string;
  description: string;
  priority: "must" | "should" | "optional";
}

export interface LlmProvider {
  readonly name: string;
  // Enrich a single requirement chunk into the human-facing leaf fields.
  enrichLeaf(input: EnrichInput): Promise<EnrichResult>;
  // Verify a proposed consolidation merge (does the chunk belong to the leaf?).
  verifyMerge(leaf: CandidateLeaf, candidate: Chunk): Promise<boolean>;
  // Extract obligations from unstructured text (general conditions / preamble).
  extractObligations(input: { text: string; language: string }): Promise<Obligation[]>;
}
