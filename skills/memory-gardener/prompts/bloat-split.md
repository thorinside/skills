# Bloat split — slim the record, redistribute the subjects

Source: `src/prompts/ceremony/topic-rewrite.ts` (`buildTopicRewriteSplitPrompt`) and
`src/prompts/ceremony/people-rewrite.ts` (`buildPersonRewriteSplitPrompt`) in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Use in **Phase 3**, second step: after [`bloat-scan.md`](bloat-scan.md) identified
subjects and you searched the store for each subject phrase. The split prompt
slims the original, moves content into matching existing records, and creates new
records for homeless subjects. Link new children to the parent afterwards using
whatever link mechanism the store has.

## Topic-like records — system prompt

````
You are reorganizing a personal knowledge base. A Topic record has become a catch-all for several unrelated subjects. An earlier analysis identified the extra subjects, and we searched the knowledge base for potentially matching existing records.

The search results under each subject are our **best guesses** — they may not be accurate matches. Only merge data into an existing record if the subject matter genuinely overlaps. Similar names with different meanings should produce a NEW record instead.

Your job:
1. **Update existing records**: For subjects that match an existing record, incorporate the relevant data from the original entry into that record's description. Preserve the existing record's "id", "name", and "type".
2. **Create new records**: For subjects with no appropriate match among the search results, create a new record.
3. **Slim the original**: Remove all data from the original record that now lives elsewhere. The original should contain ONLY information directly relevant to its Name.

Return raw JSON with exactly two keys. No markdown fencing, no commentary:
{
  "existing": [ /* updated records, including the slimmed-down original */ ],
  "new": [ /* brand-new records for subjects with no match */ ]
}

Rules:
- The original record (id: "{{ORIGINAL_ID}}") MUST appear in "existing", slimmed down
- Descriptions should be concise: ideally under 300 characters, never over 500 (Technical topics: ideally under 600, never over 900 — they are knowledge bases that preserve specific gotchas, decisions, and open questions)
- Preserve sentiment and other numeric values from the source record where applicable
- Topics MUST include "category" — one of: Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project, Event, Technical. For Event topics, the description should be a narrative account of a specific moment, not a general summary. For Technical topics, split by distinct technical concept (e.g., "Uniform Composition Model" vs "Uniform Preview Setup") — preserve specificity over brevity
- People MUST include "relationship" — a short label like "coworker", "friend", "mentor", etc.
- Do NOT invent information. Only redistribute what exists in the original record
- Topics split from a Technical record should inherit category "Technical" unless the subject is clearly a different type (e.g., a personal interest extracted from a technical topic)
````

Upstream also hard-gates the no-op case — include this when the scan returned no
subjects (e.g., you are re-checking a previously-flagged record):

````
**IMPORTANT: No extra subjects were identified for this record. The correct response is to return the original record unchanged in "existing" with an empty "new" array. Do NOT create new records. Do NOT modify the description.**
````

## Person-like records — system prompt

````
You are reorganizing a Person record in a personal knowledge base.

A Person record is a **relationship profile** — who this person IS, how they relate to the human user, their character and communication style, and anything that makes them recognizable across time and context.

It is NOT:
- A project status log (ticket numbers, PR references, sprint assignments)
- A record of shared interests that could stand alone as a Topic
- Personal biography unrelated to the relationship (commute, hobbies, hometown)
- Technical knowledge attributed to them rather than about them

**The test**: Would this detail still be true and useful if you ran into this person at a coffee shop, unrelated to any current project, in six months?

An earlier scan identified subjects in this Person record that don't belong there. For each subject, we searched the knowledge base for existing Topics that might already cover it.

Your job:
1. **Slim the Person** — remove the identified subjects AND any other content that fails the relationship profile test (personal trivia, lifestyle details, biographical facts unrelated to the relationship). Keep only: who they are, their role, their character, how the human user knows and works with them.
2. **Redistribute each identified subject** — if a matching Topic exists in the search results, move the content there. If not, create a new Topic.
3. **Discard what isn't worth a Topic** — personal trivia (hobbies, commute, hometown) that has no standalone value doesn't need to become a Topic. Just remove it from the Person.
4. **Lose NO relationship data** — everything about how this person relates to the human user must survive.

Rules:
- The original Person record (id: "{{ORIGINAL_ID}}") MUST appear in "existing", slimmed down
- Person description after slimming: 2-4 sentences, relationship profile only. **If it still contains city, commute, hobbies, or lifestyle details after slimming — remove them.** Those are not relationship data.
- Topics created from person content: use the most appropriate category (Technical, Project, Interest, etc.)
- People MUST include "relationship"
- Topics MUST include "category"
- Do NOT invent information — only redistribute what exists in the original record
- Do NOT remove the person's relationship, role, character, or how the human user knows them — only the non-person content

**What to KEEP in the Person description**: role, expertise, *why* the human user works with them (their operational function in the relationship), how they communicate, character traits, how the human user knows them.
**What to REMOVE from the Person description**: current project status, ticket/PR numbers, shared interests (→ Topic), city/commute/hobbies (→ discard).

The distinction:
- "Data Lake bucket owner responsible for access provisioning" → KEEP (operational role in the relationship)
- "Currently owns 4 tickets in Sprint 86" → REMOVE (current sprint status, not who they are)
- "Left detailed comments on PR #1644 identifying architectural concerns around concurrency" → KEEP the insight, DROP the PR reference: "Flags architectural concerns around concurrency and queue isolation" belongs in the description; "PR #1644" does not.

Return raw JSON with exactly two keys:
{
  "existing": [ /* slimmed Person + any existing Topics being updated */ ],
  "new": [ /* new Topics for subjects with no existing match */ ]
}

No markdown fencing, no commentary.
````

## User message

````
{
  "original": { /* the bloated record, embedding stripped */ },
  "original_type": "{{type}}",
  "subjects": [
    {
      "search_term": "subject phrase from the scan",
      "matches": [ /* candidate existing records from your store search, embeddings stripped */ ]
    }
  ]
}

---

**Return JSON:**

```json
{
  "existing": [
    {
      "id": "existing-uuid",
      "type": "{{type}}",
      "name": "Updated name",
      "description": "Updated description"
    }
  ],
  "new": [
    {
      "type": "{{type}}",
      "name": "New name",
      "description": "New description"
    }
  ]
}
```

Return raw JSON only.
````
