---
name: memory-collector
description: Harvest coding-agent session transcripts already on disk (Claude Code, Codex, OpenCode, Cursor, Pi) and extract durable knowledge — topics, people, facts, events, quotes — into whatever persistent memory the agent can reach. Cursor-tracked, budgeted, read-only on sources. Use when asked to collect/import/mine session history into memory, build memory from past sessions, or as a scheduled task. Composes with memory-gardener, which tends what this skill plants.
---

# Memory collector

Your richest memory source is sitting untouched on disk: every coding-agent
session ever run on this machine. Transcripts full of decisions, gotchas, open
questions, people, and the occasional quotable outburst — none of it queryable,
all of it rotting in JSONL.

This skill is the collector: a budgeted, cursor-tracked harvest that mines those
transcripts and plants durable knowledge into whatever memory stores the current
environment exposes. It is **storage-agnostic** (capabilities discovered at run
time, like [memory-gardener](../memory-gardener/SKILL.md)) and **source-aware**
(it knows where coding tools keep their sessions). The extraction prompts ship in
[`prompts/`](prompts/README.md), carried from EI's extraction pipeline by Jeremy
Scherer (MIT).

**The composition**: the collector plants; the gardener prunes. Collection
deliberately tolerates near-duplicates and overgrowth — the gardener's validate
gate, dedup curator, and bloat-split exist precisely to tend what collection
produces. Don't make the collector perfect; make the pair converge.

## Ground rules — the safety contract

1. **Sources are read-only.** Never modify, move, or delete a transcript file.
2. **Stores are additive.** The collector creates and updates memory items; it
   never deletes. Anything that looks delete-worthy is the gardener's job.
3. **Budget every run.** Default: **3 sessions** (or ~150 messages) per run,
   oldest unprocessed first. Stop at the budget; the cursor makes the next run
   continue cleanly.
4. **Skip live sessions.** A transcript modified in the last ~30 minutes (or
   whose tool is plainly mid-session) gets skipped — half-written sessions
   extract badly. It will be there next run.
5. **Never store secrets.** Coding transcripts contain tokens, connection
   strings, ARNs, and keys. If an extracted value is shaped like a credential,
   drop it. The shipped prompts already exclude these from quotes; apply the
   same bar to every field you store.
6. **Conservative is the law.** The shipped prompts are tuned so that *empty
   results are the most common response*. Honor that — noise is worse than gaps.
7. **Provenance is mandatory.** Every stored item carries its source id (see
   Phase 4). An item you can't trace back to a session is a rumor.

## Phase 0 — survey

**Transcript sources.** Check which of these exist on this machine (paths are
the tools' defaults; verify before assuming):

| Tool | Where sessions live | Format |
|---|---|---|
| Claude Code | `~/.claude/projects/<project>/*.jsonl` | JSONL records (user/assistant/meta) |
| Codex | `~/.codex/` | SQLite + JSONL rollouts |
| OpenCode | local app data | SQLite + JSON |
| Cursor | `~/Library/Application Support/Cursor/User/` (macOS) | workspace state |
| Pi | `~/.pi/agent/sessions/*.jsonl` | JSONL |

**Memory stores.** Discover capabilities from the tool surface exactly as the
gardener's Phase 0 does — memory search/mutation, knowledge graph, diary, stats.
Don't assume tool names.

**The cursor.** Find the previous collection state: a memory item or artifact
tagged `collector-cursor` holding, per source, a map of processed session ids →
processed-at timestamps (this map is the sole source of truth — EI's
`processed_sessions` pattern). No cursor → first run: start with the **most
recent few sessions**, not all of history; backfill over subsequent runs.

## Phase 1 — select

From each available source, list sessions not in the cursor, oldest first, and
take sessions up to the budget. Apply the live-session guard (rule 4). Derive a
human title for each session from its working directory (`.../Projects/ei` →
"ei") — it anchors extraction context.

## Phase 2 — convert

Reduce each session to a clean speaker-labeled conversation:

- Keep **human text and assistant text only**. Drop thinking blocks, tool calls,
  tool results, system noise, and sub-agent chatter — extraction wants the
  conversation, not the machinery.
- Give every message a fully qualified id: `<tool>:<machine>:<session>:<msg>`
  (e.g., `claudecode:mbp:0a1f…:42`). Quotes and provenance point at these.
- Process the session in **windows** (~20–40 messages). For each window, the
  window itself is the "Most Recent Messages" and a compact tail of what came
  before is the "Earlier Conversation" — the shipped prompts are built around
  exactly this split and only ever analyze the recent window.

## Phase 3 — extract

Run the shipped pipelines over each window, with `technical_context: true` for
coding-tool sessions (it makes Technical a priority category):

1. **Topics** — [`prompts/topics.md`](prompts/topics.md): scan flags candidate
   topics → match checks each against existing memory (conservative: unsure ⇒
   "new") → update writes the record under the right discipline (Event
   narratives; Technical *accumulate, don't synthesize*; everything else
   *synthesize, don't accumulate*). Quotes ride along.
2. **People** — [`prompts/people.md`](prompts/people.md): scan flags people
   (confidence 1–5, identifier capture, self/hypothetical guards) → match by
   identifiers first, then name → update under the person disciplines. For
   coding sessions most windows yield nobody; that's correct.
3. **Events** — [`prompts/events.md`](prompts/events.md): once per session, the
   campaign-recap test ("The Night We Debugged the CPU"). Empty is the norm.
4. **Facts** — [`prompts/facts.md`](prompts/facts.md): only if you maintain a
   missing-facts list (kept beside the cursor). No list, no run.

## Phase 4 — store

Write extractions into the discovered stores, mapping fields onto the store's
schema (confidence/exposure-impact → importance-like fields; categories →
tags/containers; drop fields the store can't hold rather than inventing
homes). Tag everything `source:<tool>:<machine>:<session>` plus
`collected:<ISO date>`.

Where the store distinguishes recent/unreviewed items, leave new items visibly
new — the gardener's validate gate ([its Phase 1](../memory-gardener/SKILL.md))
is the door these newcomers are supposed to walk through. If both a fast store
and a structured knowledge store exist, put summaries where retrieval happens
and structure (entities, links) where the graph lives.

## Phase 5 — advance the cursor & report

Update the cursor only for sessions **fully** processed — a budget-truncated
session stays uncursored and resumes next run. Then report:

```
# Collection report — <ISO timestamp>
Sources: <tool: sessions found / processed / skipped-live>
Windows analyzed: N · budget used: <sessions>/<max>
Planted: topics N (new X, updated Y) · people N · events N · facts N · quotes N
Dropped: secrets-shaped values N · low-confidence extractions N
Cursor: advanced to <session id / timestamp> per source
Handoff: <n> new items awaiting the gardener's validate gate
```

## Running periodically

Same hosting story as the gardener: any scheduler that can invoke an agent with
this skill. A good rhythm — **collector daily, gardener nightly after it** — so
each harvest is tended within a day. Both are budget-capped; worst case is a
report that says "nothing new."

## Provenance & credit

The extraction pipeline (scan → match → update), its conservative defaults, the
three description disciplines, the quote bar-test, and the prompts in
[`prompts/`](prompts/README.md) come from [Flare576/ei](https://github.com/Flare576/ei)
by **Jeremy Scherer** (MIT, © 2026 Jeremy Scherer) — EI runs this pipeline
against five coding tools as its importer layer. This skill generalizes the
storage side and pairs it with [memory-gardener](../memory-gardener/SKILL.md).
