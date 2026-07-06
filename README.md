# Tender Extractor

Extracts a tender (one or more PDFs) into a single, three-level tree of
`ProcurementMatchDeliverable` objects — the deliverable shape from the brief.
The design is **structure-first**: a deterministic position-grammar recovers the
requirement tree before any LLM is involved, and the LLM sits behind a clean
interface for enrichment, obligation extraction, and merge verification. The
pipeline runs **fully offline by default** (no API key); with a key it uses an
OpenAI-compatible endpoint (currently OpenAI `gpt-4o-mini`).

## Cold start

Requirements: **Node ≥ 20**. Optional for OCR of corrupted pages: `poppler`
(`pdftoppm`) and `tesseract` — on macOS `brew install poppler tesseract`.
Without them the pipeline still runs; corrupted pages stay flagged instead of
repaired.

```bash
npm install
npm start -- --input "../<folder with the tender PDFs>" --output output
```

That runs offline with a deterministic stub. To enable the LLM, copy
`env/.env.example` to `env/.env`, add your key, and pass `--use-llm`:

```bash
npm start -- --input ".." --use-llm --llm-concurrency 8
```

Provider is selected by `LLM_BASE_URL` + `LLM_MODEL` in `env/.env` (any
OpenAI-compatible API), so switching models is config-only.

### Flags

| Flag | Meaning |
|---|---|
| `--input <dir>` | folder of the tender's PDFs (required) |
| `--output <dir>` | output root (default `output`) |
| `--use-llm` | enrich, extract obligations, verify merges via the LLM |
| `--llm-concurrency N` | parallel LLM requests (default 6) |
| `--llm-max N` | cap LLM-enriched leaves for the run (rest use the stub) |
| `--merge-max N` | cap `verifyMerge` calls in semantic consolidation (default 60) |

## Output (`output/<tenderId>/`)

| File | Contents |
|---|---|
| `tree.json` | the 3-level `ProcurementMatchDeliverable` tree |
| `chunks.json` | every source chunk with its stable id |
| `manifest.json` | files, SHA-256, page counts |
| `coverage-report.json` | schema validity, chunk coverage, faithfulness |
| `references.json` | resolved / unresolved cross-references and annexes |

## How it works

```
ingest → extract(quality gate, OCR fallback) → classify → parseLv / parseProse
       → buildLeaves → extractPreamble → consolidate → consolidateSemantic
       → resolveReferences → assembleTree → validate
```

- **ingest** — manifest: stable file ids, SHA-256, role/language guess.
- **extract** — `pdfjs-dist` pulls text *with positions*; a per-page quality
  gate scores text as clean / corrupted / image-only. Corrupted pages are
  re-read via OCR (`pdftoppm` + `tesseract --psm 6`), bypassing the broken font
  map.
- **classify** — strips repeated header/footer chrome by frequency; tags each
  page (toc / preamble / lv_positions / prose_spec / recap / form).
- **parseLv** — deterministic position grammar. Two grammars: GAEB `NN.NN.NNNN`
  and a room-coded scheme `GU.20.05.01.01` (code glued to the title with no
  space). One chunk per position.
- **parseProse** — for tenders with no position grammar: structural heading
  detection + numbered/bulleted lists.
- **buildLeaves** — turns each chunk into a candidate leaf via the `LlmProvider`
  interface (offline stub by default); grouping keys come from the code.
- **extractPreamble** — hands general-condition prose to the provider, which
  returns discrete obligations (insurance, H&S, standards, deadlines) as leaves
  under a "General Conditions" branch.
- **consolidate / consolidateSemantic** — exact-id merge, then LLM-verified
  near-duplicate merge (lexical retrieval + `verifyMerge`), subgroup-scoped.
- **resolveReferences** — internal `Position "X"` links and external annex
  references; a referenced annex not present in the folder is flagged
  (confidence `medium`) and logged, not dropped silently.
- **assembleTree** — 3-level tree from the document's own structure.
- **validate** — Zod schema + coverage audit (every content chunk referenced by
  a leaf) + a faithfulness score (how much of each description is grounded in its
  source chunks).

Every stage logs one JSON line per step; each artifact is written to disk.

## Design choices

- **Structure-first, LLM-second.** On a ~1,500-position LV, letting an LLM
  *discover* requirements causes both misses and inventions. The grammar recovers
  leaf candidates deterministically; the LLM only enriches them and extracts
  obligations from genuinely unstructured prose. This keeps recall high and
  hallucination low.
- **LLM behind an interface.** `llm/provider.ts` defines `enrichLeaf`,
  `extractObligations`, `verifyMerge`. A deterministic stub keeps the pipeline
  runnable offline; one OpenAI-compatible HTTP adapter handles the real calls.
  Token usage and a cost estimate are logged; calls run in a bounded concurrency
  pool with 429/5xx retry + backoff.
- **Self-defined chunk ids** — `{fileId}:p{page}:{ozCode}` — stable, auditable.
- **`LocaleObject` = `{ <lang>: string }`**, emitting the source language.
- **Granularity = one leaf per position.** Positions repeating across rooms stay
  separate (different quantities); identical bulletPoints in one subgroup merge.
  Quantities/units (no schema field) are folded into the text.
- **Downstream fields** (`fullfillable`, `status`, `aiReasoning`, feedback,
  cited-* arrays, `openQuestionId`) set to the documented empty/null defaults.

## Results (sample run, `--use-llm`, `gpt-4o-mini`)

| Metric | Value |
|---|---|
| Leaves (Level 3) | 1,103 · tree 14 × 710 × 1,103 (L1/L2/L3) |
| Schema valid | yes |
| Chunk coverage | 100% (1,578 chunks, 0 orphans) |
| Faithfulness (`avgGrounding`) | 0.862 · 93 leaves flagged `< 0.5` for review |
| Consolidation | 471 exact-id merges + 4 LLM-verified (of 60 candidates) |
| LLM calls / cost / time | 1,611 · ≈ $0.10 · ≈ 6 min |

Per tender: **Fahrradgaragen** 6/6 positions + 3 general-condition obligations;
**Salzburg** ~1,527 positions (real subgroup labels, ~450 repeats consolidated)
+ 14 obligations; **Christmas Lights** 15 numbered requirements (after OCR
repair) + 13 contractual prose obligations.

## Quality — what works, what's weak

- **Fahrradgaragen (clean GAEB):** effectively complete; "oder gleichwertig" caught.
- **Salzburg (409 pp, room-coded):** ~1,527 positions ≈ 100% of what the grammar
  can see (~95% of a ~1,599 rough total), with real subgroup labels.
- **Christmas (prose, broken font):** OCR repairs the text; obligations rise from
  ~40% to ~80% of what the tender imposes.

**Weaknesses / next:**

- **Cross-document / annex linking is detected, not auto-resolved.** Referenced
  annexes aren't in the sample folders, so they're flagged unresolved. Full
  cross-page merging needs real embeddings + human review; auto-merging risks
  false links, so it is deliberately conservative.
- **Internal `Position "X"` references** mostly live in preamble prose not chunked
  as positions, so few resolve on this data.
- **Equivalence recall** on Salzburg is partial (~21 of ~33).
- **The LLM paraphrases**, so faithfulness (0.862) is below the verbatim stub
  (1.0). For a faithfulness-critical use, descriptions can be kept verbatim and
  the LLM used only for priority/labels. `lowGroundingLeaves` flags drift for review.
- **Page-kind / modality heuristics** are tuned to DE/EN; a very different
  language would degrade grouping (grammar/prose recall still holds).

## For production

Persistent requirement graph with incremental annex re-linking; real embeddings
plus a labelled gold-tree eval harness; native GAEB ingestion; a review UI
feeding the confidence/feedback loop; model routing + caching.
