import { z } from "zod";
import { log } from "../logger";
import type { CandidateLeaf, Chunk } from "../types/internal";
import type { EnrichInput, EnrichResult, LlmProvider } from "./provider";

const EnrichResponse = z.object({
  bulletPoint: z.string().min(1).max(240),
  description: z.string().min(1),
  priority: z.enum(["must", "should", "optional"]),
  equivalenceAllowed: z.boolean().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

const MergeResponse = z.object({ merge: z.boolean() });

const ApiResponse = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      prompt_cache_hit_tokens: z.number().optional(),
    })
    .optional(),
});

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

// Approximate DeepSeek V4 Flash (deepseek-chat) rates, USD per 1M tokens.
const RATE_INPUT = 0.14;
const RATE_CACHED = 0.0028;
const RATE_OUTPUT = 0.28;

export class DeepSeekProvider implements LlmProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  readonly usage = { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.model = config.model ?? "deepseek-chat";
    this.name = `deepseek:${this.model}`;
  }

  private async jsonCompletion<T>(
    stage: string,
    system: string,
    user: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const MAX_RETRIES = 8;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const backoff = (n: number) => Math.min(1000 * 2 ** n, 30_000) + Math.floor(Math.random() * 400);

    let response: Response | undefined;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
            temperature: 0,
            max_tokens: 1600,
          }),
          signal: AbortSignal.timeout(90_000),
        });
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await sleep(backoff(attempt));
          continue;
        }
        throw error;
      }

      // Rate limit / transient server errors -> back off and retry. Honor the
      // Retry-After header, or the "try again in Xs" hint some providers put in
      // the body (Groq's token-per-minute limit does this).
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
        const body = await response.text().catch(() => "");
        const headerRA = Number(response.headers.get("retry-after"));
        const bodyRA = Number(body.match(/try again in ([\d.]+)\s*s/i)?.[1]);
        const waitMs =
          headerRA > 0 ? headerRA * 1000 : bodyRA > 0 ? Math.ceil(bodyRA * 1000) + 400 : backoff(attempt);
        log.warn(stage, `provider ${response.status}; retrying`, { attempt: attempt + 1, waitMs });
        await sleep(waitMs);
        continue;
      }
      break;
    }

    if (!response!.ok) {
      const body = (await response!.text()).slice(0, 500);
      if (response!.status === 401) {
        throw new Error(
          `DeepSeek rejected the API key (401). Check DEEPSEEK_API_KEY in env/.env — it may be wrong or expired. ${body}`,
        );
      }
      throw new Error(`DeepSeek API ${response!.status} ${response!.statusText}: ${body}`);
    }

    const api = ApiResponse.parse(await response!.json());
    this.usage.calls += 1;
    if (api.usage) {
      this.usage.promptTokens += api.usage.prompt_tokens;
      this.usage.completionTokens += api.usage.completion_tokens;
      this.usage.cachedTokens += api.usage.prompt_cache_hit_tokens ?? 0;
    }

    const choice = api.choices[0]!;
    const content = choice.message.content?.trim();
    if (!content) throw new Error("DeepSeek returned empty content");
    if (choice.finish_reason === "length") {
      throw new Error("DeepSeek JSON response was truncated; raise max_tokens or shrink the chunk");
    }

    try {
      return schema.parse(JSON.parse(content));
    } catch (error) {
      log.error(stage, "invalid structured response from DeepSeek", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`DeepSeek returned invalid JSON for ${stage}`);
    }
  }

  // Rough cost of the run so far, in USD, based on the model's published rates.
  estimatedCostUsd(): number {
    const input = (this.usage.promptTokens - this.usage.cachedTokens) / 1e6 * RATE_INPUT;
    const cached = this.usage.cachedTokens / 1e6 * RATE_CACHED;
    const output = this.usage.completionTokens / 1e6 * RATE_OUTPUT;
    return Number((input + cached + output).toFixed(4));
  }

  async enrichLeaf(input: EnrichInput): Promise<EnrichResult> {
    const system = [
      "You extract procurement requirements faithfully.",
      "Return one JSON object only with exactly these fields:",
      '{"bulletPoint":"short label","description":"faithful requirement","priority":"must|should|optional","equivalenceAllowed":true|false|null,"confidence":"high|medium|low"}.',
      "Do not invent facts or translate the source. Preserve quantities, standards, deadlines and constraints.",
      "Use equivalenceAllowed=null when the source is silent, false only when alternatives are explicitly prohibited.",
      "priority: must=mandatory/contractual, should=preferred, optional=explicitly optional.",
    ].join("\n");
    const user = [
      `Source language: ${input.language}`,
      `Tender modality legend: ${input.modalityLegend ?? "not found"}`,
      `Position: ${input.chunk.ozCode ?? "none"}`,
      `Title: ${input.chunk.title ?? "none"}`,
      "SOURCE CHUNK:",
      input.chunk.text,
    ].join("\n");
    return this.jsonCompletion("llm.enrich", system, user, EnrichResponse);
  }

  async verifyMerge(leaf: CandidateLeaf, candidate: Chunk): Promise<boolean> {
    const system = [
      "Decide whether a source chunk describes, constrains, or supplies details for the SAME procurement requirement.",
      'Return valid JSON only: {"merge":true} or {"merge":false}.',
      "Reject merely similar items or shared vocabulary unless the text explicitly shares scope.",
    ].join("\n");
    const user = [
      "EXISTING REQUIREMENT:",
      leaf.descriptionSource,
      "CANDIDATE SOURCE CHUNK:",
      candidate.text,
    ].join("\n");
    const result = await this.jsonCompletion("llm.verifyMerge", system, user, MergeResponse);
    return result.merge;
  }
}
