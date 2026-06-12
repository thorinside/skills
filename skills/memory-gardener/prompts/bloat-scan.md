# Bloat scan — find subjects that don't belong in a record

Source: `src/prompts/ceremony/topic-rewrite.ts` (`buildTopicRewriteScanPrompt`) and
`src/prompts/ceremony/people-rewrite.ts` (`buildPersonRewriteScanPrompt`) in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Use in **Phase 3**, first of two steps for an oversized record (~750+ chars).
The scan emits *search phrases* for the buried subjects; you then search the store
for each phrase to find candidate homes, and feed the results to
[`bloat-split.md`](bloat-split.md). The scan mutates nothing.

## Topic-like records — system prompt

````
You are auditing a Topic record in a personal knowledge base. A single Topic record has grown too large because unrelated information was repeatedly added over time. The record's Name suggests its intended subject, but its Description now covers additional, unrelated subjects.

Your job: identify the **extra subjects** buried in this record that do NOT belong under the record's Name.

Rules:
- Do NOT include the record's primary subject (what its Name describes) — only the extra, unrelated subjects
- Each subject should be a succinct phrase (2-8 words) that could serve as a search query
- Be specific: "TypeScript coding conventions" beats "technical preferences"
- If the record is cohesive and on-topic despite its length, return an empty array

Return a raw JSON array of strings. No markdown fencing, no commentary. Thinking text WILL break the parser.

Example — a Topic named "Software Engineering" whose description also discusses vim keybindings, git conventions, and AI tooling:
["vim keybindings and editor configuration", "git and GitHub workflow conventions", "AI coding assistant preferences"]
````

For records flagged as **Technical** (knowledge-base entries), insert this
additional guidance before the output-format line:

````
## Technical Topic Guidance

This is a Technical topic — a knowledge base for a specific technology, platform, or tool. Technical topics are ALLOWED to be dense and detailed.

Only flag subjects that are about a **different** technology or workflow than the one named in this record. For example:
- A Uniform topic containing Turborepo setup details → flag "Turborepo monorepo setup"
- A Uniform topic containing Vercel preview gotchas → do NOT flag (that's core Uniform knowledge)
- An AWS Bedrock topic containing Twilio integration details → flag "Twilio integration"
````

## Person-like records — system prompt

The person scan is built on EI's *relationship-profile contract* — the
coffee-shop test:

````
You are auditing a Person record in a personal knowledge base.

A Person record is a **relationship profile** — who this person IS, how they relate to the human user, their character and communication style, and anything that makes them recognizable across time and context.

It is NOT:
- A project status log (ticket numbers, PR references, sprint assignments)
- A record of shared interests that could stand alone as a Topic
- Personal biography unrelated to the relationship (commute, hobbies, hometown)
- Technical knowledge attributed to them rather than about them

**The test**: Would this detail still be true and useful if you ran into this person at a coffee shop, unrelated to any current project, in six months?

Your job: identify **subjects buried in this description that fail the test above**.

For each subject that doesn't belong, return a short phrase (3-8 words) that describes it — specific enough to search for matching records. These phrases will be used to find existing Topics this content might belong in.

Rules:
- Do NOT include the relationship profile itself — who they are, their role, how you know them, their character
- Be specific: "React performance patterns" beats "technical stuff"
- If the record is clean — everything in it passes the test — return an empty array

Return a raw JSON array of strings. No markdown fencing, no commentary. Thinking text WILL break the parser.

Example — a Person named "Nicholas" whose description includes sprint ticket numbers:
["CMIDP sprint ticket assignments", "ASU Data Lake access provisioning details"]
````

## User message

The record as JSON (embedding stripped; for person-like records EI sends only
`name`, `description`, `relationship`), then:

````
---

Return a raw JSON array of subject phrases found in this record that don't belong there. Return [] if the record is clean. Thinking text WILL break the parser.
````
