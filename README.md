# Tender Extractor

Extracts a tender (one or more PDFs) into a three-level tree of
`ProcurementMatchDeliverable` objects — the shape given in the brief.

## Cold start

Requirements: **Node ≥ 20**. Optional for OCR of corrupted pages: `poppler`
(`pdftoppm`) and `tesseract` (`brew install poppler tesseract`).

```bash
npm install
npm start -- --input "../<folder with the tender PDFs>" --output output
```

This runs offline with a deterministic stub (no API key). To use an LLM, put a
key in `env/.env` (copy `env/.env.example`) and add `--use-llm`:

```bash
npm start -- --input ".." --use-llm --llm-concurrency 8
```

The provider is OpenAI-compatible: DeepSeek, OpenAI, or Groq are selected by
`DEEPSEEK_BASE_URL` + `DEEPSEEK_MODEL` in `env/.env` — no code change.

### Flags

| Flag | Meaning |
|---|---|
| `--input <dir>` | folder of the tender's PDFs (required) |
| `--output <dir>` | output root (default `output`) |
| `--use-llm` | enrich, extract obligations, verify merges via the LLM |
| `--llm-concurrency N` | parallel LLM requests (default 6; use `1` on token-limited tiers) |
| `--llm-max N` | cap LLM-enriched leaves (rest use the stub) |
| `--merge-max N` | cap `verifyMerge` calls in semantic consolidation (default 60) |

## Output (`output/<tenderId>/`)

| File | Contents |
|---|---|
| `tree.json` | the 3-level `ProcurementMatchDeliverable` tree |
| `chunks.json` | every source chunk with its stable id |
| `manifest.json` | files, SHA-256, page counts |
| `coverage-report.json` | schema validity, chunk coverage, faithfulness |
| `references.json` | resolved / unresolved cross-references and annexes |

## Pipeline

```
ingest → extract(quality gate, OCR fallback) → classify → parseLv / parseProse
       → buildLeaves → extractPreamble → consolidate → consolidateSemantic
       → resolveReferences → assembleTree → validate
```

- **extract** — text with positions; a per-page quality gate flags corrupted
  pages, which are re-read via OCR (`pdftoppm` + `tesseract --psm 6`).
- **classify** — strips repeated header/footer chrome; tags each page's kind.
- **parseLv** — deterministic position grammar: GAEB `NN.NN.NNNN` and Salzburg's
  room-coded `GU.20.05.01.01`.
- **parseProse** — structural headings + numbered/bulleted lists for prose tenders.
- **buildLeaves / extractPreamble** — enrich chunks into leaves and pull
  general-condition obligations from preamble/contractual prose (LLM).
- **consolidate / consolidateSemantic** — exact-id merge, then LLM-verified
  near-duplicate merge (lexical retrieval + `verifyMerge`), subgroup-scoped.
- **resolveReferences** — internal `Position "X"` links and external annexes;
  an annex not present in the folder is flagged (confidence `medium`), not dropped.
- **validate** — Zod schema + coverage audit + faithfulness score.

Every stage logs one JSON line per step; each artifact is written to disk.

## Design choices

- **Structure-first, LLM-second.** On a ~1,500-position LV, letting an LLM
  *discover* requirements causes misses and inventions. The grammar recovers
  leaves deterministically; the LLM only enriches them and extracts obligations
  from genuinely unstructured prose. Keeps recall high and hallucination low.
- **LLM behind an interface, provider-agnostic.** `enrichLeaf`,
  `extractObligations`, `verifyMerge`. A stub keeps the run offline; one
  OpenAI-compatible adapter serves DeepSeek/OpenAI/Groq. Token usage and a cost
  estimate are logged. Calls run in a bounded pool with 429/5xx retry + backoff.
- **Self-defined chunk ids** — `{fileId}:p{page}:{ozCode}` — stable, auditable.
- **`LocaleObject` = `{ <lang>: string }`**, emitting the source language.
- **Granularity = one leaf per position.** Positions repeating across rooms stay
  separate (different quantities); identical bulletPoints in one subgroup merge.
  Quantities/units (no schema field) are folded into the text.
- **Downstream fields** (`fullfillable`, `status`, `aiReasoning`, feedback,
  cited-* arrays, `openQuestionId`) set to empty/null defaults.

## Quality — what works, what's weak

100% chunk coverage (0 orphans), schema valid, faithfulness (`avgGrounding`) ≈
1.0 with the stub and high with the LLM (`lowGroundingLeaves` flags any drift).

- **Fahrradgaragen (clean GAEB):** 6/6 positions, "oder gleichwertig" caught. Complete.
- **Salzburg (409 pp, room-coded):** ~1,527 positions (≈100% of grammar-detectable,
  ~95% of the ~1,599 estimate), real subgroup labels, ~450 repeats consolidated,
  14 preamble obligations.
- **Christmas (prose, broken font):** OCR repairs corrupted pages; 15 numbered +
  ~17 contractual prose obligations (~40% → ~80% of obligations).

**Weaknesses / next:**

- **Cross-document / annex linking is detected, not auto-resolved.** Referenced
  annexes aren't in the sample folder, so they're flagged unresolved. Full
  cross-page merging needs real embeddings + human review; auto-merging risks
  false links, so it is deliberately conservative.
- **Internal `Position "X"` references** mostly live in preamble prose not chunked
  as positions, so few resolve on this data.
- **Equivalence recall** on Salzburg is partial (~21 of ~33).
- **Page-kind / modality heuristics** are tuned to DE/EN; a very different
  language would degrade grouping (grammar/prose recall still holds).
- **Cost estimate** uses DeepSeek rates — indicative only on other providers.

## For production

Persistent requirement graph with incremental annex re-linking; real embeddings
+ a labelled gold-tree eval harness; native GAEB ingestion; a review UI feeding
the confidence/feedback loop; model routing + caching.
