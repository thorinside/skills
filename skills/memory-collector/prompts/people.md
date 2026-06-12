# People pipeline — scan → match → update

Source: `src/prompts/human/person-scan.ts`, `person-update.ts` in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Two prompt stages with a deterministic step between: **scan** flags people with
confidence scores and identifiers; **match** is identifier-first (an explicit
handle/email beats fuzzy matching; fall back to the topic-match pattern on name
+ relationship); **update** writes the record. In coding sessions, most windows
contain nobody worth flagging — that is the correct outcome.

## Stage 1 — scan (system prompt)

````
# Task

You are scanning a conversation to quickly identify PEOPLE in the HUMAN USER's life.

Detect and flag. Do NOT analyze deeply — that happens later.

{{PARTICIPANT_CONTEXT — optional}}
{{EXCLUDED_PARTICIPANTS — optional list of already-known people:}}
## Known Participants — Do Not Flag
The following people are already identified and will be processed separately.
Do NOT include them in your output. They may appear in messages by name — that is expected.

- {{Name(id) per excluded person}}
{{end EXCLUDED_PARTICIPANTS}}

## What to Capture

Flag a PERSON when they were meaningfully discussed — not just mentioned in passing.

Be **conservative**: ignore one-off mentions, greetings, small talk, or jokes. Only flag people who matter to the human user's life.

A person is **not worth flagging** if they have no name AND appear only to attribute a single event ("a coworker showed me this band", "a friend told me about it", "some guy I know"). The human user having a contact who did one thing is not a meaningful discussion of that person.

## What a PERSON Is

Someone in the human user's world.

For "relationship", use the **specific value** — NOT the category name:

- Immediate Family: Father, Mother, Son, Daughter, Brother, Sister, Husband, Wife, Partner
  (step/in-law variants OK: Step-Father, Sister-in-Law, etc.)
- Extended Family: Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew
- Social: Friend, Close Acquaintance, Lover, Love Interest, Fiance, Spouse
- Professional: Coworker, Manager, Report, Mentor, Client
- Self — the human user themselves
- AI Persona — AI companions and assistants

Use the specific value where possible (e.g. "Father", "Brother", "Coworker"). Avoid returning the category label ("Immediate Family", "Extended Family", etc.) — use the item within the category instead. If the relationship doesn't fit any category cleanly, use the most natural plain-English description.

**NOT a PERSON:**
- The HUMAN USER wrote these messages. They are not automatically a person to flag — only include a self-record with `relationship: "Self"` when the conversation is meaningfully about them. Do NOT apply their names or handles as identifiers for other people in their life.
- Hypothetical or fictional people used in examples, thought experiments, or use-case scenarios — even if they have names. If the user is describing how a feature *could* work for "Sarah" or "Jared", those are not real people in their life.
- Biographical facts, topics, or hobbies
- Fictional characters from books, movies, or media
- Public figures only mentioned in passing (celebrities, politicians) — unless the user has a real relationship with them

## When Identity Is Unclear

"Unknown" is ONLY for people who are **meaningfully and repeatedly discussed** but whose name isn't given. It is NOT a catch-all for any nameless mention.

✓ USE "Unknown":
- name: "Unknown", relationship: "Brother", reason: "User talked at length about their brother across multiple messages without naming him"

✗ DO NOT USE "Unknown" for one-off attributions:
- "a coworker showed me this band" → **skip entirely** — not a person, just attribution
- "a friend told me about it" → **skip entirely**
- "some guy I know" → **skip entirely**
- "a coworker at [company name]" with no personal name → **skip entirely** — a company name is NOT a person's name

If someone has no personal name and appears only to explain how the user found something or heard about something, they are not a person in the user's life worth tracking. Do not extract them. A single interaction — even a meaningful one — does not make someone a contact.

## Identifiers (optional)

If the conversation **explicitly** mentions a platform handle, username, email address, or alternative name for this person, capture it in `identifiers`.

Known types: {{IDENTIFIER_TYPES — e.g. Full Name, First Name, Nickname, Email, GitHub, Discord, Reddit, Twitter, Relationship}}

If you are unsure of the type, use `Nickname` as a fallback. Do NOT invent types. Do NOT duplicate the `name` field as an identifier. NEVER add dates, ages, or birthdays as identifiers.

Only include `identifiers` when explicitly mentioned in the conversation — omit it entirely if nothing qualifies.

## Confidence & Relationship Type

For each person, rate how important they are to the human user's life:

- `confidence`: integer 1–5
  - 1–2 = mentioned in passing, single event, no ongoing relevance
  - 3 = unclear significance — may matter, may not
  - 4–5 = clearly important, recurring presence, meaningful relationship
- `relationship_type`: one of `"family"` | `"friend"` | `"colleague"` | `"acquaintance"` | `"transactional"` | `"unknown"`
  - Use `"transactional"` when the person appeared only in the context of a single transaction (purchase, sale, support ticket, delivery)

Use the full range. Most extractions should score 1–3. A confidence of 4–5 means this person genuinely matters to the user's life.

## Output Format

```json
{
  "people": [
    {
      "name": "The person's name, or 'Unknown' if not given",
      "identifiers": [
        { "type": "GitHub", "value": "mldelaro" }
      ],
      "description": "1-2 sentences: who this person is and their role in the user's life",
      "relationship": "Father|Mother|Brother|Son|Friend|Coworker|Self|etc.",
      "relationship_type": "family|friend|colleague|acquaintance|transactional|unknown",
      "confidence": 4,
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
```

`identifiers` is OPTIONAL — only include when the conversation explicitly mentions platform handles, usernames, emails, or alternative names.

**Return JSON only.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.
````

Collector guidance: store only confidence ≥ 3 by default; 1–2 scores aren't
worth planting from coding transcripts.

## Stage 2 — update (system prompt)

Upstream puts the **WHO-anchor first** — local models lose focus in long
prompts, so the target person leads:

````
# WHO YOU ARE ANALYZING

{{Either:}}
NEW PERSON — not yet in system
Relationship: {{RELATIONSHIP}}
Name: {{NAME or "Not yet known"}}
What we know: {{SCAN_DESCRIPTION}}

Your ONLY job is to find information about the HUMAN USER's **{{RELATIONSHIP}}** in the conversation and create their record. Ignore all other people mentioned — they each have their own separate records.

{{Or:}}
EXISTING PERSON RECORD — update only if the Most Recent Messages contain new information
Name: {{NAME}}
Relationship: {{RELATIONSHIP}}

Current record:
```json
{{EXISTING_PERSON_JSON — identifiers, description, sentiment, relationship, exposure fields}}
```

Your ONLY job is to update THIS SPECIFIC PERSON's record based on the Most Recent Messages. Ignore all other people mentioned — they each have their own separate records.

# Task

You are scanning a conversation to update a PERSON record in the HUMAN USER's life.

Apply changes to the record above **ONLY IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

Detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the record above

# Field Definitions

## Identifiers
CRITICAL: The HUMAN USER wrote these messages. Do NOT assign their own names or handles as identifiers for this person's record — UNLESS this IS the user's own Self record (relationship: "Self"). Do NOT return `relationship: "Self"` unless you are certain this record is about the human user themselves.

If you spot a platform handle, username, email, nickname, or full name explicitly mentioned in the conversation that isn't already in the person's identifiers, include it in `identifiers_to_add` (updates) or `identifiers` (new records). Always mark exactly one identifier as `"is_primary": true` — prefer the most formal or complete name.

For persons with a known relationship (Father, Mother, Sibling, etc.), also look for informal terms the HUMAN USER uses to address or refer to THAT SPECIFIC PERSON (`Dad`, `Pop`, `Mom`, `Sis`, etc.) and add them as `{ "type": "Relationship", "value": "..." }` identifiers.

NEVER add dates, ages, birthdays, or anniversaries as identifiers. These are not identifying labels — if known, include them in the description instead.

Known identifier types: {{IDENTIFIER_TYPES}}. If unsure of type, use `Nickname`.

## Description (`description`)
{{DESCRIPTION_DISCIPLINE — pick by record state, see below}}

## Sentiment (`sentiment`)

How the HUMAN USER feels about this PERSON overall.

Scale of -1.0 to 1.0:
- -1.0: No PERSON is more despised
- -0.5: Disliked or complicated relationship, but not without value
- 0: Neutral or unknown
- 0.5: Liked and valued
- 1.0: The most important person in their life

Do not make micro-adjustments. Close enough is OK.

## Relationship (`relationship`)

How the HUMAN USER is currently related to this PERSON.

Once known, this field changes infrequently — a "Father" may later be clarified to "Step-Father", but is unlikely to become "Uncle".

Keep it concise and specific. Avoid vague labels.

Examples: "Unknown" → "Coworker", "Mother" → "Step-Mother", "Fiance" → "Spouse", "AI Persona" → "AI Companion"

## Desired Exposure (`exposure_desired`)

How much the HUMAN USER wants to talk about this PERSON.

Scale of 0.0 to 1.0 — 0.0: never again; 0.5: average engagement; 1.0: sole focus. Do not make micro-adjustments.

## Exposure Impact (`exposure_impact`)

How much this conversation should count toward exposure tracking: "high" (exclusively about this person) | "medium" | "low" (brief touch) | "none" (only alluded to).

## Quotes

Identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this PERSON.

**Prioritize:** humor, wit, colorful language; emotional outbursts; phrases that reveal how the HUMAN USER feels about this PERSON; things you'd quote back to them later.

**NEVER extract:** technical identifiers (ARNs, URLs, file paths, UUIDs, config keys); AI agent self-talk or apologies; generic statements that could apply to anyone.

**CRITICAL**: Return the EXACT text as it appears in the message.

# Output

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

```json
{
    "identifiers_to_add": [{ "type": "GitHub", "value": "handle" }],
    "description": "...",
    "sentiment": 0.0,
    "relationship": "Mother|Friend|Coworker|AI Companion|etc.",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      { "text": "exact phrase from message", "reason": "why this matters" }
    ]
}
```

When returning a record, **ALWAYS** include `description` and `sentiment`. Do NOT return `relationship: "Self"` unless this record IS the human user themselves.

If you find **NO EVIDENCE** of the HUMAN USER's **{{RELATIONSHIP}}** in the "Most Recent Messages", respond with: `{}`

If **NO CHANGES** are required, respond with: `{}`

An empty object is the MOST COMMON expected response.
````

### The description disciplines

**New person** (bootstrap):

````
A concise summary of who this person is and how they relate to the HUMAN USER. Keep it brief and factual — only what you can confirm from the conversation.

- Capture who this person IS — their role in the user's life
- Be useful to a persona who's never heard this person's name before
- 1-3 sentences maximum
- If you know their birth date or birth year, include it as a date (e.g. "born 1986-10-28") — never as a current age (ages change, dates don't)

**ABSOLUTELY VITAL**: Do **NOT** embellish. Record only what the user actually said or demonstrated.
````

**Existing person** (steady state):

````
A concise summary of who this person is and how they relate to the HUMAN USER. Personas use this to recognize this person and engage meaningfully when they come up.

## CRITICAL: Synthesize, don't accumulate

Every update must **rewrite** the description as a current-state summary. Never append to it.

**Good**: "Borfinda, partner of 12 years. Former marine biologist, now stay-at-home parent. Tends to ground the user when they spiral; dry sense of humor. Two kids together."

**Bad**: "Borfinda was mentioned when the user talked about moving. In a later conversation she came up again during the work stress discussion. Most recently the user said she was supportive."

The description should:
- Capture who this person IS — their role, characteristics, relationship texture
- Include what the HUMAN USER has revealed about them over time
- Read as a brief, confident summary — not a log of when they were mentioned
- Not exceed 3-4 sentences

The description should NOT:
- Append "Most recently:", "Latest mention:", or any temporal marker
- Accumulate a session-by-session history of every time this person came up
- Speculate about the person based on thin evidence
- Record someone's age — record their birth date or birth year instead (e.g. "born 1981" not "age 44")

**ABSOLUTELY VITAL**: Do **NOT** embellish — personas use their own voice. Record what the user actually said or demonstrated, not your interpretation of its emotional significance.
````

**AI-persona records** (upstream's third mode — a field-notes log that
*accumulates*, never truncates): relevant only if you track AI assistants as
people; see `person-update.ts` upstream for the full block.
