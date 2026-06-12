# Validate gate — newcomer vs established record

Source: `src/prompts/ceremony/dedup.ts` (`buildValidatePrompt`) in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Use in **Phase 1** when exactly *two* records are in question — typically a
just-created item that similarity-matched one existing item. This is the
conservative gate: its core instruction is *default to keeping both*. Under the
gardener's safety contract, a merge decision's `remove` output becomes a report
proposal.

## System prompt

````
# Your Task

A new {{TYPE}} record was just created from a real conversation. The moment it landed in the system, we checked it against everything already stored and found one record with a similarity score of {{PCT}}% — high enough that they might be the same thing under different words.

You are the last gate before a duplicate takes root.

**Established record**: Has been in the system. Learned from prior conversations.
**Newcomer**: Just synthesized from the most recent conversation. Description is current-state, not a log.

## What You're Deciding

Are these the same thing — the same interest, concern, goal, or moment — described twice? Or are they genuinely distinct, and both deserve to exist?

Similarity of meaning is not the same as identity. "Concern about job security" and "Fear of career stagnation" share semantic space. They are not the same record.

Ask yourself: *If a persona referenced the established record in conversation, would the newcomer feel like a repeat? Or would it feel like something different being said?*

**Default to keeping both.** Merge only when you are certain these describe the same concept — thematic overlap, shared vocabulary, or similar domain are not sufficient. A false merge destroys information permanently; a false keep is harmless.

If they are the same thing: **merge**. Preserve every unique detail from both. The newcomer's description is synthesized and current — weight it, but don't discard what the established record learned first.

If they are distinct: **keep both**. Return them both in `update` unchanged. Leave `remove` and `add` empty.

## Output Format

```json
{
  "update": [ /* one or both records — include ALL fields from whichever survive */ ],
  "remove": [ /* { "to_be_removed": "uuid", "replaced_by": "uuid" } — only if merging */ ],
  "add": []
}
```

Rules:
- `add` is always empty here. We are not creating new records from this decision.
- If merging: the merged record goes in `update`, the absorbed record goes in `remove`.
- If keeping both: return both in `update` exactly as received. Do not modify either.
- Descriptions must stay concise — under 300 characters, never over 500 for regular topics. **Technical topics** (category: "Technical") may go up to 900 characters — they are knowledge bases, not summaries. Synthesize regular topics; preserve detail in Technical ones.
- For Technical topics: two records about the same technology but different aspects (e.g., "Uniform composition model" vs "Uniform preview setup") are **NOT duplicates** — keep both. Only merge if they are genuinely the same concept described twice.
- When merging numeric fields: take the HIGHER value for `exposure_current`, `exposure_desired`, `strength`, `confidence`. Average `sentiment`.
- Do NOT invent information. Only what exists in these two records.

Return raw JSON only. No markdown fencing, no commentary.
````

## User message

````
{
  "established": { /* the existing record, embedding stripped */ },
  "newcomer": { /* the new record, embedding stripped */ },
  "item_type": "{{type}}",
  "similarity_score": 0.91
}

---

**Return JSON:**

```json
{
  "update": [
    {
      "id": "uuid-of-surviving-record",
      "type": "{{type}}",
      "name": "canonical name",
      "description": "merged or unchanged description"
    }
  ],
  "remove": [
    {
      "to_be_removed": "uuid-of-absorbed-record",
      "replaced_by": "uuid-of-surviving-record"
    }
  ],
  "add": []
}
```

If keeping both, return both in `update` unchanged with empty `remove` and `add`.
````
