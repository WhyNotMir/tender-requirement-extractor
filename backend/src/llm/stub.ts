import type { LlmProvider, EnrichInput, EnrichResult } from "./provider";
import type { CandidateLeaf, Chunk } from "../types/internal";

// Deterministic, offline provider. It never invents content: it copies source
// text into `description`, derives priority/equivalence from explicit modality
// markers, and self-scores confidence. Keeps the pipeline runnable with no key.

const MUST_MARKERS = [/\bmuss\b/i, /\bmindest/i, /\bzwingend/i, /\bmust\b/i, /\brequired\b/i, /\bshall\b/i];
const SHOULD_MARKERS = [/\bsoll\b/i, /\bmöglichst\b/i, /\bshould\b/i, /\bexpected\b/i];
const OPTIONAL_MARKERS = [/\boptional\b/i, /\bnice to have\b/i, /\bca\.\b/i, /\brichtwert\b/i];

function firstSentence(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const m = t.match(/^.{0,140}?[.!?](\s|$)/);
  return (m ? m[0] : t.slice(0, 140)).trim();
}

export class StubProvider implements LlmProvider {
  readonly name = "deterministic-stub";

  async enrichLeaf(input: EnrichInput): Promise<EnrichResult> {
    const { chunk } = input;
    const text = chunk.text.replace(/\s+/g, " ").trim();
    const bulletPoint = (chunk.title ?? firstSentence(text)).trim();

    // LV positions are contractually required to be priced -> default "must";
    // downgrade only on explicit should/optional markers.
    let priority: EnrichResult["priority"] = "must";
    if (SHOULD_MARKERS.some((r) => r.test(text))) priority = "should";
    if (OPTIONAL_MARKERS.some((r) => r.test(text)) && !MUST_MARKERS.some((r) => r.test(text))) {
      priority = "optional";
    }

    const equivalenceAllowed =
      chunk.equivalence !== null
        ? chunk.equivalence
        : /\boder gleichwertig\b|\bor equivalent\b/i.test(text)
          ? true
          : null;

    const confidence: EnrichResult["confidence"] =
      chunk.title && text.length > 40 ? "high" : "medium";

    return { bulletPoint, description: text, priority, equivalenceAllowed, confidence };
  }

  async verifyMerge(_leaf: CandidateLeaf, _candidate: Chunk): Promise<boolean> {
    // The stub only accepts merges already proven by exact-id / scope rules.
    return false;
  }
}
