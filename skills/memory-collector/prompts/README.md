# Extraction prompts

These are the human-data extraction prompts from [Flare576/ei](https://github.com/Flare576/ei)
by **Jeremy Scherer**, carried here nearly verbatim under the MIT license. In EI
they power the importer layer that ingests sessions from five coding tools; they
are tuned for high precision — *an empty result is the most common expected
response* — and that calibration is the most valuable thing in them. Resist the
urge to make them chattier.

> MIT License — Copyright (c) 2026 Jeremy Scherer
> (full text: https://github.com/Flare576/ei/blob/main/LICENSE)

## Mapping

| File | Pipeline | EI source |
|---|---|---|
| [`topics.md`](topics.md) | scan → match → update, with quotes | `src/prompts/human/topic-scan.ts`, `topic-match.ts`, `topic-update.ts` |
| [`people.md`](people.md) | scan → update, identifier-first matching | `src/prompts/human/person-scan.ts`, `person-update.ts` |
| [`events.md`](events.md) | once-per-session epic-event scan | `src/prompts/human/event-scan.ts` |
| [`facts.md`](facts.md) | targeted search for missing facts | `src/prompts/human/fact-find.ts` |

## Adaptation conventions

The originals are TypeScript template strings; interpolations appear as
`{{PLACEHOLDERS}}`:

- `{{PERSONA_NAME}}` — the assistant's name in the transcript (e.g., "Claude
  Code"). Used to label speakers when formatting the conversation.
- `{{EARLIER_CONVERSATION}}` / `{{MOST_RECENT_MESSAGES}}` — the window split
  from SKILL.md Phase 2. **Every prompt analyzes only the recent window**; the
  earlier section is context that has already been processed. Format messages
  as speaker-labeled lines.
- `{{TECHNICAL_CONTEXT}}` — include the marked technical-context block for
  coding-tool sessions; omit it for personal/chat sources.
- `{{PARTICIPANT_CONTEXT}}` — optional block naming the persona and human if
  known; omit when unknown.
- `{{EXISTING_TOPICS_JSON}}`, `{{CANDIDATE_…}}`, `{{MISSING_FACT_NAMES}}`,
  `{{IDENTIFIER_TYPES}}`, person-record fields — filled from your store and
  cursor state.
- **Record shapes** (`sentiment`, `exposure_desired`, `category`,
  `relationship`, …) are EI's schema. Map onto your store's fields; drop what
  has no home. `exposure_impact` is EI's signal for how much a conversation
  should count toward recency tracking — translate it to whatever your store
  uses, or fold it into an importance score.

Storage divergence from upstream: EI applies updates directly to its state
file. Under this skill, you write to whatever stores Phase 0 discovered, tag
provenance, and leave newcomers visible for memory-gardener's validate gate.
