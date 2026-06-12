# Ceremony prompts

These are the nightly-ceremony prompts from [Flare576/ei](https://github.com/Flare576/ei)
by **Jeremy Scherer**, carried here nearly verbatim under the MIT license. They are
the battle-tested judgment core of the gardener — Jeremy wrote, ran, and tuned these
against real personal memory; this skill only generalizes the plumbing around them.

> MIT License — Copyright (c) 2026 Jeremy Scherer
> (full text: https://github.com/Flare576/ei/blob/main/LICENSE)

## Mapping

| File | Gardener phase | EI source |
|---|---|---|
| [`dedup-cluster.md`](dedup-cluster.md) | Phase 1 — dedup a candidate cluster | `src/prompts/ceremony/dedup.ts` (`buildDedupPrompt`) |
| [`dedup-validate.md`](dedup-validate.md) | Phase 1 — two-record gate (newcomer vs established) | `src/prompts/ceremony/dedup.ts` (`buildValidatePrompt`) |
| [`dedup-confirmed.md`](dedup-confirmed.md) | Review loop — execute human-approved merges | `src/prompts/ceremony/user-dedup.ts` (`buildUserDedupPrompt`) |
| [`bloat-scan.md`](bloat-scan.md) | Phase 3 — find subjects that don't belong in a record | `src/prompts/ceremony/topic-rewrite.ts`, `people-rewrite.ts` (scan) |
| [`bloat-split.md`](bloat-split.md) | Phase 3 — slim the record, redistribute subjects | `src/prompts/ceremony/topic-rewrite.ts`, `people-rewrite.ts` (split) |

## Adaptation conventions

The originals are TypeScript template strings; interpolations appear here as
`{{PLACEHOLDERS}}`. When using a prompt:

- `{{TYPE}}` — the record type being tended ("Topic", "Person", …, capitalized).
- `{{PCT}}` — similarity as a percentage (validate gate).
- `{{ORIGINAL_ID}}` — id of the record being slimmed (split prompts).
- **`find_memory`** — EI's semantic memory search. Substitute the memory-search
  capability you discovered in Phase 0; keep the call budget.
- **`submit_dedup_decisions`** — EI's structured-output tool. If your environment
  has no equivalent, use the raw-JSON fallback the prompt already specifies.
- **Record shapes** — the field examples (`sentiment`, `exposure_current`,
  `relationship`, `category`, …) are EI's schema. Map them onto your store's
  fields; where your store lacks a field, drop that line rather than inventing
  one. The *merge rules* (HIGHER for strength/confidence-like fields, AVERAGE for
  sentiment-like, union of unique description details) transfer as-is.
- The model named in the HARD RULES header reflects what EI was running; swap in
  whatever model executes your run. The anti-overthinking rules are the point —
  keep them.

Mutation mode (SKILL.md ground rule 1): upstream EI applies `remove` decisions
directly, and this skill's **autonomous mode** matches that behavior. In the
default **tend-and-propose** mode, `remove` output goes to the report's
*Proposed* queue instead, and `dedup-confirmed.md` executes entries once the
human approves them.
