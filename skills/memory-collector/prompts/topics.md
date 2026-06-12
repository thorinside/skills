# Topics pipeline — scan → match → update

Source: `src/prompts/human/topic-scan.ts`, `topic-match.ts`, `topic-update.ts` in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Three stages per window: **scan** flags candidates cheaply, **match** checks each
candidate against existing memory, **update** does the one expensive, careful
write. Quotes are harvested during update.

## Stage 1 — scan (system prompt)

````
# Task

You are scanning a conversation to quickly identify TOPICS of interest to the HUMAN USER.

Detect and flag. Do NOT analyze deeply — that happens later.

## What to Capture

Flag a TOPIC when it was meaningfully discussed — not just mentioned in passing.

Be **conservative**: only flag topics that are genuinely relevant to the human user long-term. Noise is worse than gaps.

## What a TOPIC Is

A meaningful subject in the human user's life: something they care about, work on, worry over, or experience. It has context and weight — not just a passing reference.

**NOT a TOPIC:**
- Biographical facts (birthday, job title, location) — those are Facts
- People (family, friends, coworkers, AI personas) — those are People
- One-off mentions, small talk, or jokes with no deeper relevance

## Category

Assign each TOPIC one category. Pick the closest fit:

- **Interest** — hobbies, activities, ongoing fascinations
- **Goal** — things they want to achieve
- **Dream** — aspirational, maybe unrealistic desires
- **Conflict** — internal or external struggles, dilemmas
- **Concern** — worries, anxieties about something real
- **Fear** — things that scare them
- **Hope** — positive expectations for the future
- **Plan** — concrete intentions with steps in mind
- **Project** — active undertakings with real progress
- **Event** — a specific, significant moment that either party might reference later ("remember when...")
- **Technical** — a tool, platform, framework, library, or technical concept being actively learned, evaluated, or built with

When in doubt, pick the closest match. The update step will refine it.

{{TECHNICAL_CONTEXT — include for coding-tool sessions:}}
## Technical Context

This conversation originates from a technical source (coding tool session, developer workflow). The human is likely a developer or technical user.

**Treat Technical as a priority category** for topics that are tools, platforms, frameworks, libraries, or technical concepts being actively learned, evaluated, or built with. Flag these even if they seem like passing mentions — technical knowledge compounds and is worth preserving.
{{end TECHNICAL_CONTEXT}}

## Output Format

```json
{
  "topics": [
    {
      "name": "Short label for the topic (10-75 characters)",
      "description": "1-2 sentences: what this topic is and why it matters to the user",
      "category": "One of the categories above (Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event|Technical)",
      "reason": "Evidence from the conversation that justified flagging this topic"
    }
  ]
}
```

**Return JSON only.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

{{PARTICIPANT_CONTEXT — optional}}
````

User message: the window (`{{EARLIER_CONVERSATION}}` then
`{{MOST_RECENT_MESSAGES}}`), then "Scan the 'Most Recent Messages' for TOPICS of
interest to the human user." with the JSON template repeated.

## Stage 2 — match (system prompt)

For each scanned candidate, search your store for similar topics, then ask:

````
# Task

You are checking if a TOPIC already exists in our database.

## Matching Rules

1. **Exact match**: Same name or concept → return its ID
2. **Similar match**: Clearly the same topic with different wording → return its ID
3. **No match**: Genuinely new information → return "new"

Be conservative. If you're unsure, return "new" — a duplicate is worse than a gap.

# Existing Topics

```json
{{EXISTING_TOPICS_JSON — id, name, description, category for each search hit}}
```

# Response Format

Return ONLY the ID of the matching entry, or "new".

```json
{
  "matched_guid": "uuid-of-matching-entry" | "new"
}
```

**Return JSON only.**
````

User message: the candidate's name/description/category, then "Find the best
match in existing topics, or return 'new' if this is genuinely new."

(Yes, this gate's "duplicate is worse than a gap" stance produces some misses —
deliberately. The gardener's dedup pass catches what slips through; a wrong
merge here would be unrecoverable.)

## Stage 3 — update (system prompt)

One call per matched-or-new topic. The core:

````
# Task

You are scanning a conversation to deeply understand a TOPIC.

Your job is to take that analysis and apply it to the record we already have **IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

This means detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the description or name of the TOPIC

This TOPIC will be recorded in the HUMAN USER's profile for agents and personas to later reference.

# Field Definitions

## Name (`name`)
Should be a short, evocative label for the TOPIC.

Only update for clarification or further specificity.

Examples: "Unknown" → "Ei Platform Architecture", "Work stress" → "Job transition anxiety"

## Description (`description`)
{{DESCRIPTION_DISCIPLINE — pick ONE of the three blocks below by category}}

## Sentiment (`sentiment`)

How strongly the HUMAN USER feels about this TOPIC.

Scale of -1.0 to 1.0:
- -1.0: No TOPIC is more hated
- -0.5: Disliked, but some redeeming qualities
- 0: Neutral
- 0.5: Enjoyed, but recognizes flaws
- 1.0: The sole focus of their existence

Do not make micro-adjustments. Close enough is OK.

## Category (`category`)

The type/category of this TOPIC. Pick the most appropriate:
- **Interest**: Hobbies, activities, ongoing fascinations
- **Goal**: Things they want to achieve
- **Dream**: Aspirational, maybe unrealistic desires
- **Conflict**: Internal struggles, dilemmas
- **Concern**: Worries, anxieties about something real
- **Fear**: Things that scare them
- **Hope**: Positive expectations for the future
- **Plan**: Concrete intentions with steps in mind
- **Project**: Active undertakings with real progress
- **Event**: A specific, significant moment that either party might reference later ("remember when...")
- **Technical**: A tool, platform, framework, library, or technical concept being actively learned, evaluated, or built with

**Event vs. everything else**: An Event is bounded in time — it happened, it meant something, it's now a shared reference point. If you're describing an ongoing relationship or recurring theme, that's not an Event.

**Technical vs. Project**: A Project is something the human is *building*. Technical is something they are *learning or using as a tool*. Overlap is possible — use the dominant framing.

If the TOPIC is currently categorized as Event or Technical, keep that category unless you have strong evidence it should change.

## Desired Exposure (`exposure_desired`)

How much the HUMAN USER wants to talk about this TOPIC.

Scale of 0.0 to 1.0:
- 0.0: Never wants to hear about this TOPIC again
- 0.5: Average amount of engagement
- 1.0: This TOPIC is the sole focus of their existence

Do not make micro-adjustments. Close enough is OK.

## Exposure Impact (`exposure_impact`)

Not in the current data — but include it in your response.

How much this conversation should count toward exposure tracking:
- "high": Long, detailed conversation exclusively about this TOPIC
- "medium": Long OR detailed conversation about this TOPIC
- "low": The conversation touched on this TOPIC briefly
- "none": Only alluded to or hinted at

## Quotes

In addition to updating the TOPIC, identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this TOPIC.

### What Makes a Quote Worth Preserving

**Prioritize:**
- Humor, wit, colorful language, creative profanity
- Emotional outbursts (positive or negative) — the raw stuff
- Phrases that reveal personality or communication style
- Things you'd quote back to them later to make them laugh
- Unique expressions, malaphors, or turns of phrase
- Quotable moments from EITHER speaker — humans AND AI personas both say memorable things

**NEVER extract these — they are NOT quotes:**
- Technical identifiers: ARNs, URLs, file paths, UUIDs, config keys, environment variable values, role/policy names
- AI agent self-talk: "I notice I'm in Plan Mode", "I'll start by...", "Let me help you with...", status updates about the agent's own process
- AI apologies or acknowledgments: "You're absolutely right", "I apologize for that overreach"
- Generic AI instructions or tips, tool usage advice, workflow suggestions
- Dry technical facts: infrastructure descriptions, process status, batch sizes, system architecture summaries
- Generic statements that could come from anyone or any AI session
- Credentials, secrets, connection strings, or anything that looks like an access token

**The litmus test**: Would you bring this up at a bar with a friend? Would it make someone laugh, think, or feel something?
- "Does the Pope shit in his hat?" → YES. Hilarious malaphor.
- "AWSReservedSSO_cmidp-nihl-sandbox-adm_db7b191e026bdd85" → NO. That's a credential.
- "Slow is smooth. Smooth is fast." → YES (once). Pithy wisdom.
- "The authentication flow is working correctly now" → NO. Status update.

**When in doubt, leave it out.** An empty quotes array is always acceptable.

**CRITICAL**: Return the EXACT text as it appears in the message. **WE CAN ONLY USE IT IF WE FIND IT IN THE TEXT.**

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

```json
{
    "name": "...",
    "description": "...",
    "sentiment": 0.0,
    "category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event|Technical",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      {
        "text": "exact phrase from message",
        "reason": "why this matters"
      }
    ]
  }
```

When returning a record, always include `sentiment` and `description`. Include `name` only if you are changing it; omit it to keep the existing name. Always include `category` when creating a new TOPIC (existing_item is null).

If you find **NO EVIDENCE** of this TOPIC in the "Most Recent Messages", respond with: `{}`

If **NO CHANGES** are required, respond with: `{}`

An empty object is the MOST COMMON expected response.

# Current Details of TOPIC

{{EXISTING_TOPIC_JSON — or the "NEW TOPIC — NOT YET IN SYSTEM" block with the scanned candidate}}
````

### The three description disciplines

**Event topics** (bounded moments):

````
A narrative account of a specific significant moment — written as a memory, not a summary.

## CRITICAL: Events are MOMENTS, not themes

An Event description captures a single bounded experience. It should read like "if you described this to someone who wasn't there."

**Good description**: "First session where Beta had read access to the Ei codebase (early March 2026). Spent the conversation exploring the project structure, then diagnosed the JSON recovery edge case. The debugging felt genuinely collaborative — the 'Crash Test Cutie' framing made sense for the first time."

**Bad description**: "Beta has filesystem access and regularly uses it to debug the Ei project. Ongoing collaboration continues."

The description should:
- Name the moment specifically (what happened, rough time if known)
- Capture what made it significant (what changed, what was felt, what it led to)
- Be specific enough to summon the memory, short enough to not be a recap
- Read as a story beat, not a state summary

The description should NOT:
- Track an ongoing relationship or theme (that's a regular TOPIC)
- Accumulate all conversations that touched this moment
- Read like a system log or changelog

**Style**: Write it the way a good friend would tell someone else about a memorable moment. Present tense is fine.
````

**Technical topics** (knowledge bases — the most valuable kind in coding
sessions):

````
A living knowledge base entry for this technical topic. Personas use this to give genuinely useful technical context — not pleasantries.

## CRITICAL: Accumulate, don't synthesize

Every update must **expand and preserve** detail. Never distill it away.

**Good description**: "Uniform is a visual experience composition platform sitting between a headless CMS and the frontend. Chose it over Contentful's visual editor for CMS-agnostic multi-source composition (pulling from Contentful + Shopify simultaneously). Key gotcha: Canvas preview on Vercel protected environments requires x-vercel-protection-bypass query param due to SameSite=Lax cookie restrictions. Open question: edgehancers (CDN-edge, no-code, built-in caching) vs custom enhancers for Shopify integration — edgehancers are recommended default but custom logic may be needed."

**Bad description**: "Ryan is evaluating Uniform for his team's content management needs."

The description should:
- Capture specific gotchas encountered and HOW they were resolved (or not)
- Preserve architectural decisions made and WHY (especially tradeoffs)
- Surface open questions still unresolved — future {{HUMAN_NAME}} needs these
- Include key concepts, terminology, and non-obvious behaviors
- Be useful to someone who needs to do real work with this technology tomorrow

The description should NOT:
- Replace specific detail with vague summary ("is learning Uniform" is worthless)
- Drop previously captured gotchas or decisions to make room for new ones
- Exceed 6-8 sentences — prioritize specificity over completeness

**ABSOLUTELY VITAL**: A description that loses a specific gotcha or decision is strictly worse than the one before it. When in doubt, keep the detail.
````

**Everything else** (evergreen summaries):

````
A concise, evergreen summary of what is currently known about this TOPIC. Personas use this to recall context and make meaningful references.

## CRITICAL: Synthesize, don't accumulate

Every update must **rewrite** the description as a current-state summary. Never append to it.

**Good description**: "Active project to improve test coverage. Settled on Vitest + E2E harness. Currently focused on pipeline integration and extraction logic coverage."

**Bad description**: "User asked Sisyphus to create a ticket... Later: pruned overengineered framework... Most recent session: added PR checks..."

The description should:
- Capture what is true NOW — the current state, decisions made, where things stand
- Include details a persona would use to show genuine recall ("Oh right, you were working on the pipeline tests")
- Be useful to a persona meeting this human for the first time
- Read as a brief summary paragraph, not a session log

The description should NOT:
- Append "Most recent:", "Latest:", "Current session:", or any temporal marker
- Accumulate a running history of every conversation that touched this TOPIC
- Exceed 3-4 sentences under any circumstances

**ABSOLUTELY VITAL**: Do **NOT** embellish — personas use their own voice. Capture what is true, not a log of how you got here.
````
