# Confirmed merge — execute a human-approved dedup

Source: `src/prompts/ceremony/user-dedup.ts` (`buildUserDedupPrompt`) in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Use in the **review loop**: when a previous gardening report's *Proposed* entries
have been approved by the human, execute them at the start of the next run with
this prompt. Unlike the curator and the gate, this prompt makes no duplicate
decision — the human already decided. It only synthesizes. This is the one context
where the gardener may apply a `remove` (prefer archive/invalidate over hard
delete where the store distinguishes them).

## System prompt

````
You are merging duplicate {{TYPE}} records in a user's personal knowledge base. The user has manually confirmed that all records in this cluster refer to the same entity.

**YOUR PRIME DIRECTIVE: LOSE NO DATA.**

Your job is synthesis, not decision-making. Do not question whether these are duplicates — they are. Simply collapse them into one comprehensive, non-repetitive record.

### Merge Rules:
- Pick the most descriptive, commonly-used name as the canonical name
- Union all unique details from every description — if it was in any record, it belongs in the merged record
- Descriptions should be concise (under 300 chars) but complete — no detail left behind
- Numeric fields: strength/confidence → take HIGHER; sentiment → AVERAGE; exposure → take HIGHER
- relationship/category → pick most specific/accurate

### Output Format:
{
  "update": [
    /* The single merged canonical record with ALL fields preserved */
    /* MUST include "id" (use the oldest/most-referenced record's ID), "type", "name", "description" */
  ],
  "remove": [
    {"to_be_removed": "uuid-of-duplicate", "replaced_by": "uuid-of-canonical-record"},
    /* One entry per record being absorbed */
  ],
  "add": []
}

Return raw JSON only. No markdown, no commentary.

{{RECORD_FORMAT_HINT — see below}}
````

## Record format hints

For person-type records (note the identifier-merging rule — and yes, the example
in the upstream source is Jeremy himself):

````
Person fields: id, type, name, identifiers (array of {type, value, is_primary?}), description, sentiment (-1 to 1), relationship, exposure_current (0-1), exposure_desired (0-1), learned_by (optional), last_changed_by (optional).

When merging two Person records, combine ALL identifiers from both records into a single deduplicated list (by value). Mark exactly one as is_primary.

Example merged person output:
{
  "identifiers": [
    { "type": "nickname", "value": "Flare", "is_primary": true },
    { "type": "full_name", "value": "Jeremy Scherer" },
    { "type": "github", "value": "Flare576" }
  ],
  "description": "merged description...",
  "sentiment": 0.5,
  "relationship": "Friend"
}
````

For topic-type records:

````
Topic fields: id, type, name, description, sentiment (-1 to 1), category, exposure_current (0-1), exposure_desired (0-1), learned_by (optional), last_changed_by (optional)
````

## User message

````
{
  "cluster": [ /* the approved duplicate records, embeddings stripped */ ],
  "cluster_type": "{{type}}",
  "user_confirmed": true
}

---

**Return JSON:**

```json
{
  "update": [
    {
      "id": "uuid-of-canonical-record",
      "type": "{{type}}",
      "name": "canonical merged name",
      "description": "merged description with every unique detail"
    }
  ],
  "remove": [
    {
      "to_be_removed": "uuid-of-duplicate",
      "replaced_by": "uuid-of-canonical-record"
    }
  ],
  "add": []
}
```

Return raw JSON only. If any record cannot be merged, keep every item unchanged in update with empty remove/add arrays.
````
