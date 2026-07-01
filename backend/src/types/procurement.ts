import { z } from "zod";

// The exact deliverable shape from the BOND brief. One tree of these per tender,
// nested through `deliverableArray`. Level 1 / Level 2 are grouping nodes;
// Level 3 leaves carry the actual requirement.

// A LocaleObject maps a language code -> string, e.g. { de: "..." }.
export type LocaleObject<T> = Record<string, T>;

export interface ProcurementMatchDeliverable {
  bulletPoint: string;
  description: LocaleObject<string>;
  priority: "must" | "should" | "optional";
  confidence: "high" | "medium" | "low" | null;
  equivalenceAllowed: boolean | null;
  fullfillable: "yes" | "no" | "maybe" | null;
  status:
    | "waitingForAnalysis"
    | "waitingForAnswer"
    | "waitingForAnswerPropagation"
    | "waitingForReview"
    | "userDefined";
  aiReasoning: LocaleObject<string> | null;
  feedback: "good" | "bad" | null;
  feedbackText: string | null;
  openQuestionId: string | null;
  deliverableArray: ProcurementMatchDeliverable[];
  procurementDocumentChunkIdArray: string[];
  workspaceDocumentChunkIdArray: string[];
  citedProductIdArray: string[];
  citedPersonIdArray: string[];
}

// Fields owned by later stages of BOND's system — we emit their empty/null
// defaults, as the brief instructs.
export const downstreamDefaults = {
  fullfillable: null,
  status: "waitingForAnalysis" as const,
  aiReasoning: null,
  feedback: null,
  feedbackText: null,
  openQuestionId: null,
  workspaceDocumentChunkIdArray: [] as string[],
  citedProductIdArray: [] as string[],
  citedPersonIdArray: [] as string[],
};

// Runtime schema mirroring the interface; used by the validate stage later.
export const DeliverableSchema: z.ZodType<ProcurementMatchDeliverable> = z.lazy(() =>
  z.object({
    bulletPoint: z.string().min(1),
    description: z.record(z.string()),
    priority: z.enum(["must", "should", "optional"]),
    confidence: z.enum(["high", "medium", "low"]).nullable(),
    equivalenceAllowed: z.boolean().nullable(),
    fullfillable: z.enum(["yes", "no", "maybe"]).nullable(),
    status: z.enum([
      "waitingForAnalysis",
      "waitingForAnswer",
      "waitingForAnswerPropagation",
      "waitingForReview",
      "userDefined",
    ]),
    aiReasoning: z.record(z.string()).nullable(),
    feedback: z.enum(["good", "bad"]).nullable(),
    feedbackText: z.string().nullable(),
    openQuestionId: z.string().nullable(),
    deliverableArray: z.array(DeliverableSchema),
    procurementDocumentChunkIdArray: z.array(z.string()),
    workspaceDocumentChunkIdArray: z.array(z.string()),
    citedProductIdArray: z.array(z.string()),
    citedPersonIdArray: z.array(z.string()),
  }),
);
